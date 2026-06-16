import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket } from 'ws';
import { encodePcm16ToMulaw } from '../audio/mulaw-codec';
import { prepareOutboundPcm16 } from '../audio/audio-gain.util';
import { Pcm16StreamDownsampler, resamplePcm16 } from '../audio/pcm-resampler';
import { analyzePcm16, formatPcm16Stats } from '../audio/pcm-stats.util';
import { isSpeechLikePcm16 } from '../audio/speech-detection.util';
import { voiceDebugLog } from '../audio/voice-debug.util';
import { VoiceAudioConfigService } from '../audio/voice-audio-config.service';
import { AudioGateway } from '../audio.gateway';
import { VoiceSessionService } from '../voice-session.service';
import {
  buildGaSessionUpdate,
  buildRealtimeWsHeaders,
  isOpenAiOutputAudioDeltaEvent,
  OpenAiOutputAudioFormat,
  OpenAiTurnDetectionMode,
  OPENAI_REALTIME_SAMPLE_RATE,
  parseOpenAiOutputAudioFormat,
} from './openai-realtime-ga.util';
import {
  VoiceRuntimeProvider,
  VoiceRuntimeSessionContext,
  VoiceRuntimeStatus,
} from './voice-runtime.provider';
import { VoiceOpeningContext } from '../voice-opening.types';
import {
  buildOpeningResponseInstructions,
  buildOpeningSessionInstructions,
  buildPostOpeningSessionInstructions,
  DEFAULT_REALTIME_INSTRUCTIONS,
} from '../voice-opening.util';

const SMARTFLO_SAMPLE_RATE = 8000;
const OPENAI_SAMPLE_RATE = OPENAI_REALTIME_SAMPLE_RATE;
const MULAW_SILENCE_BYTE = 0xff;
const INPUT_COMMIT_DELAY_MS = 600;
const MANUAL_FALLBACK_SILENCE_MS = 800;
const RESPONSE_WAIT_MS = 15000;
const SESSION_READY_TIMEOUT_MS = 5000;
const WS_OPEN_TIMEOUT_MS = 8000;

const DEFAULT_INSTRUCTIONS = DEFAULT_REALTIME_INSTRUCTIONS;

/** Live Smartflo path: no gain/normalize — recording applies its own mix at finalize. */
const LIVE_OUTBOUND_PCM_OPTIONS = {
  autoNormalize: false,
  gain: 1,
} as const;

interface OpenAiRealtimeSession {
  streamSid: string;
  ws: WebSocket;
  status: VoiceRuntimeStatus;
  connectedAt?: Date;
  sessionReady: boolean;
  outboundMulawBuffer: Buffer;
  outboundPcmDownsampler: Pcm16StreamDownsampler;
  outboundChunkBytes: number;
  outputAudioFormat: OpenAiOutputAudioFormat;
  pendingPcm8: Buffer[];
  closing: boolean;
  commitTimer?: NodeJS.Timeout;
  manualFallbackSilenceTimer?: NodeJS.Timeout;
  manualFallbackSpeechDetected: boolean;
  manualFallbackCommitCount: number;
  responseRequested: boolean;
  responseInProgress: boolean;
  responseComplete: boolean;
  responseWaiters: Array<() => void>;
  totalInputPcm24Sent: number;
  totalOutputMulawSent: number;
  inputAppendCount: number;
  commitCount: number;
  responseCount: number;
  responseCreateCount: number;
  responseDoneCount: number;
  outboundMediaCount: number;
  lastCloseCode?: number;
  lastCloseReason?: string;
  useServerVad: boolean;
  model: string;
  openingContext?: VoiceOpeningContext;
  openingGreetingRequested: boolean;
  openingGreetingPending: boolean;
  openingGreetingComplete: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitizeApiKey(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/[^\x20-\x7E]+/g, '');
}

function extractAudioDelta(event: Record<string, unknown>): string | undefined {
  const direct = event.delta;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  const audio = asRecord(event.audio);
  if (audio && typeof audio.delta === 'string' && audio.delta.length > 0) {
    return audio.delta;
  }

  return undefined;
}

@Injectable()
export class OpenAIRealtimeProvider implements VoiceRuntimeProvider {
  readonly name = 'openai-realtime';
  private readonly logger = new Logger(OpenAIRealtimeProvider.name);
  private readonly sessions = new Map<string, OpenAiRealtimeSession>();
  private readonly loggedOpenAiOutputByStreamSid = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AudioGateway))
    private readonly audioGateway: AudioGateway,
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceAudioConfigService: VoiceAudioConfigService,
  ) {}

  private getTurnDetectionMode(): OpenAiTurnDetectionMode {
    const raw = this.configService
      .get<string>('OPENAI_REALTIME_TURN_DETECTION')
      ?.trim()
      .toLowerCase();
    return raw === 'manual' ? 'manual' : 'server_vad';
  }

  async createSession(context: VoiceRuntimeSessionContext): Promise<void> {
    const { streamSid } = context;
    if (!streamSid) {
      return;
    }

    if (this.sessions.has(streamSid)) {
      await this.endSession(streamSid);
    }

    const apiKey = sanitizeApiKey(this.configService.get<string>('OPENAI_API_KEY'));
    const model =
      this.configService.get<string>('OPENAI_REALTIME_MODEL')?.trim() ??
      'gpt-realtime';

    if (!apiKey) {
      const message = 'OPENAI_API_KEY is not configured or invalid';
      this.logger.error({ streamSid, message });
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeError: message,
      });
      return;
    }

    this.updateRuntimeState(streamSid, {
      runtimeProvider: this.name,
      runtimeStatus: 'connecting',
      runtimeError: undefined,
    });

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    this.logger.log({
      streamSid,
      model,
      apiKeyPrefix: `${apiKey.slice(0, 8)}...`,
      message: 'Opening OpenAI Realtime WebSocket',
    });

    const ws = new WebSocket(url, {
      headers: buildRealtimeWsHeaders(apiKey),
    });

    const useServerVad = this.getTurnDetectionMode() === 'server_vad';
    const outboundChunkBytes = this.voiceAudioConfigService.getOutboundChunkBytes();

    const session: OpenAiRealtimeSession = {
      streamSid,
      ws,
      status: 'connecting',
      sessionReady: false,
      outboundMulawBuffer: Buffer.alloc(0),
      outboundPcmDownsampler: new Pcm16StreamDownsampler(
        OPENAI_SAMPLE_RATE,
        SMARTFLO_SAMPLE_RATE,
      ),
      outboundChunkBytes,
      outputAudioFormat: 'pcm',
      pendingPcm8: [],
      closing: false,
      manualFallbackSpeechDetected: false,
      manualFallbackCommitCount: 0,
      responseRequested: false,
      responseInProgress: false,
      responseComplete: false,
      responseWaiters: [],
      totalInputPcm24Sent: 0,
      totalOutputMulawSent: 0,
      inputAppendCount: 0,
      commitCount: 0,
      responseCount: 0,
      responseCreateCount: 0,
      responseDoneCount: 0,
      outboundMediaCount: 0,
      useServerVad,
      model,
      openingContext: context.openingContext,
      openingGreetingRequested: false,
      openingGreetingPending: false,
      openingGreetingComplete: false,
    };
    this.sessions.set(streamSid, session);

    ws.on('open', () => {
      session.status = 'connected';
      session.connectedAt = new Date();
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'connected',
        runtimeConnectedAt: session.connectedAt,
        runtimeLastEventAt: new Date(),
        runtimeError: undefined,
        isOpenAiConnected: true,
      });
      this.sendSessionUpdate(session, model);
      this.logger.log({
        streamSid,
        model,
        turnDetection: useServerVad ? 'server_vad' : 'manual',
        message: 'OpenAI Realtime WebSocket open',
      });

      setTimeout(() => {
        if (!session.sessionReady && !session.closing) {
          session.sessionReady = true;
          this.tryStartOpeningGreeting(session);
          this.flushPendingInputIfReady(session);
          this.logger.warn({
            streamSid,
            message: 'session.updated not received; proceeding with audio anyway',
          });
        }
      }, SESSION_READY_TIMEOUT_MS);
    });

    ws.on('message', (data) => {
      this.handleServerMessage(streamSid, data);
    });

    ws.on('error', (error) => {
      this.logger.error({ streamSid, err: error }, 'OpenAI Realtime WebSocket error');
      session.status = 'error';
      this.resetResponseGuards(session, 'openai_ws_error');
      this.clearManualFallbackSilenceTimer(session);
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeLastEventAt: new Date(),
        runtimeError: error.message,
        lastError: error.message,
      });
      this.resolveResponseWaiters(session);
    });

    ws.on('close', (code, reason) => {
      session.status = 'closed';
      session.lastCloseCode = code;
      session.lastCloseReason = reason.toString();
      this.clearCommitTimer(session);
      this.clearManualFallbackSilenceTimer(session);
      this.resetResponseGuards(session, 'openai_ws_close');
      this.resolveResponseWaiters(session);

      this.logger.warn({
        streamSid,
        code,
        reason: reason.toString(),
        inputAppendCount: session.inputAppendCount,
        totalInputPcm24Sent: session.totalInputPcm24Sent,
        totalOutputMulawSent: session.totalOutputMulawSent,
        closing: session.closing,
        message: 'OpenAI Realtime WebSocket closed',
      });

      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeLastEventAt: new Date(),
        runtimeError: `OpenAI WebSocket closed: ${code} ${reason.toString()}`,
      });

      if (session.closing) {
        this.sessions.delete(streamSid);
      }
    });
  }

  handleAudio(streamSid: string, pcm16Audio: Buffer): void {
    const session = this.sessions.get(streamSid);
    if (!session) {
      this.logger.warn({
        streamSid,
        pcmBytes: pcm16Audio.length,
        message: 'No OpenAI session for streamSid — was createSession called?',
      });
      return;
    }

    if (pcm16Audio.length === 0) {
      return;
    }

    if (!session.sessionReady || session.ws.readyState !== WebSocket.OPEN) {
      session.pendingPcm8.push(pcm16Audio);
      this.logger.log({
        streamSid,
        pcmBytes: pcm16Audio.length,
        pendingChunks: session.pendingPcm8.length,
        wsReadyState: session.ws.readyState,
        message: 'Queued inbound audio until OpenAI session is ready',
      });
      return;
    }

    this.appendInputAudio(session, pcm16Audio);
  }

  async endSession(streamSid: string): Promise<void> {
    const session = this.sessions.get(streamSid);
    if (!session) {
      return;
    }

    session.closing = true;
    this.clearCommitTimer(session);
    this.clearManualFallbackSilenceTimer(session);

    const wsOpen = await this.waitForWebSocketOpen(session, WS_OPEN_TIMEOUT_MS);
    if (wsOpen) {
      session.sessionReady = true;
      this.flushPendingInput(session);
      if (!session.useServerVad) {
        await this.commitInputAndCreateResponse(session, { forceOnEnd: true });
      } else if (
        !session.responseComplete &&
        !session.responseInProgress &&
        session.totalInputPcm24Sent > 0
      ) {
        await this.commitInputAndCreateResponse(session, { forceOnEnd: true });
      }
      await this.waitForResponseComplete(session, RESPONSE_WAIT_MS);
      this.flushRemainingOutbound(session);
    } else {
      this.logger.error({
        streamSid,
        pendingChunks: session.pendingPcm8.length,
        totalInputPcm24Sent: session.totalInputPcm24Sent,
        lastCloseCode: session.lastCloseCode,
        lastCloseReason: session.lastCloseReason,
        message: 'OpenAI WebSocket not open during endSession — no AI response possible',
      });
    }

    const { ws } = session;

    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      ws.once('close', () => resolve());
      ws.close();
      setTimeout(() => resolve(), 2000);
    });

    this.sessions.delete(streamSid);
    this.updateRuntimeState(streamSid, {
      runtimeStatus: 'closed',
      runtimeLastEventAt: new Date(),
      responsePending: false,
      isAwaitingOpenAiResponse: false,
    });
  }

  private sendSessionUpdate(
    session: OpenAiRealtimeSession,
    model: string,
    phase: 'opening' | 'conversation' = 'opening',
  ): void {
    const voice =
      this.configService.get<string>('OPENAI_REALTIME_VOICE')?.trim() ?? 'alloy';
    const baseInstructions =
      this.configService.get<string>('OPENAI_REALTIME_INSTRUCTIONS')?.trim();
    const instructions = session.openingContext
      ? phase === 'opening'
        ? buildOpeningSessionInstructions(
            session.openingContext,
            baseInstructions,
          )
        : buildPostOpeningSessionInstructions(
            session.openingContext,
            baseInstructions,
          )
      : (baseInstructions ?? DEFAULT_INSTRUCTIONS);

    const payload = buildGaSessionUpdate({
      voice,
      instructions,
      model,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
    });

    this.logger.log({
      streamSid: session.streamSid,
      voice,
      model,
      phase,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      hasOpeningContext: Boolean(session.openingContext),
      agentName: session.openingContext?.agentName,
      message: 'Sending OpenAI GA session.update',
    });
    session.ws.send(JSON.stringify(payload));
  }

  private completeOpeningGreeting(session: OpenAiRealtimeSession): void {
    if (session.openingGreetingComplete || !session.openingContext) {
      return;
    }

    session.openingGreetingComplete = true;
    session.openingGreetingPending = false;

    this.logger.log({
      streamSid: session.streamSid,
      agentName: session.openingContext.agentName,
      message: 'voice_opening_greeting_complete',
    });

    if (session.ws.readyState === WebSocket.OPEN) {
      this.sendSessionUpdate(session, session.model, 'conversation');
    }

    this.flushPendingInput(session);
  }

  private flushPendingInputIfReady(session: OpenAiRealtimeSession): void {
    if (session.openingContext && !session.openingGreetingComplete) {
      return;
    }

    this.flushPendingInput(session);
  }

  private shouldQueueInboundUntilOpeningComplete(
    session: OpenAiRealtimeSession,
  ): boolean {
    return Boolean(session.openingContext && !session.openingGreetingComplete);
  }

  private tryStartOpeningGreeting(session: OpenAiRealtimeSession): void {
    if (
      !session.openingContext ||
      session.openingGreetingRequested ||
      session.openingGreetingComplete ||
      session.closing
    ) {
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN || !session.sessionReady) {
      return;
    }

    this.startConversationWithGreeting(session);
  }

  startConversationWithGreeting(session: OpenAiRealtimeSession): void {
    if (
      !session.openingContext ||
      session.openingGreetingRequested ||
      session.openingGreetingComplete ||
      session.closing
    ) {
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      const message = 'OpenAI WebSocket not open for opening greeting';
      this.logger.error({
        streamSid: session.streamSid,
        message: 'voice_opening_greeting_error',
        error: message,
      });
      this.voiceSessionService.updateOpeningState(session.streamSid, {
        openingGreetingError: message,
      });
      this.completeOpeningGreeting(session);
      return;
    }

    if (session.responseRequested || session.responseInProgress) {
      this.logger.debug({
        streamSid: session.streamSid,
        message: 'Deferring opening greeting — response already in progress',
      });
      return;
    }

    session.openingGreetingRequested = true;
    session.openingGreetingPending = true;
    session.responseRequested = true;
    session.responseCreateCount += 1;

    const now = new Date();
    this.logger.log({
      streamSid: session.streamSid,
      openingContext: session.openingContext,
      message: 'voice_opening_greeting_requested',
    });
    voiceDebugLog(
      this.logger,
      session.streamSid,
      'voice_opening_greeting_requested',
      {
        agentName: session.openingContext.agentName,
        companyName: session.openingContext.companyName,
      },
      { bypassThrottle: true },
    );

    this.voiceSessionService.updateOpeningState(session.streamSid, {
      openingContext: session.openingContext,
      openingGreetingRequestedAt: now,
    });

    try {
      session.ws.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['audio'],
            instructions: buildOpeningResponseInstructions(
              session.openingContext,
            ),
          },
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to send opening greeting';
      session.openingGreetingPending = false;
      session.responseRequested = false;
      this.logger.error({
        streamSid: session.streamSid,
        err: error,
        message: 'voice_opening_greeting_error',
      });
      this.voiceSessionService.updateOpeningState(session.streamSid, {
        openingGreetingError: message,
      });
      this.completeOpeningGreeting(session);
      return;
    }

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: now,
      responseCreateCount: session.responseCreateCount,
      lastResponseCreateAt: now,
      responsePending: true,
      isAwaitingOpenAiResponse: true,
      incrementOpenAiEvent: 'response.create',
    });
  }

  private appendInputAudio(session: OpenAiRealtimeSession, pcm8: Buffer): void {
    if (this.shouldQueueInboundUntilOpeningComplete(session)) {
      session.pendingPcm8.push(pcm8);
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      session.pendingPcm8.push(pcm8);
      return;
    }

    const pcm24 = resamplePcm16(
      pcm8,
      SMARTFLO_SAMPLE_RATE,
      OPENAI_SAMPLE_RATE,
    );

    session.ws.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcm24.toString('base64'),
      }),
    );

    session.inputAppendCount += 1;
    session.totalInputPcm24Sent += pcm24.length;

    const now = new Date();
    const speechLike = isSpeechLikePcm16(pcm8);

    voiceDebugLog(this.logger, session.streamSid, 'openai_handle_audio', {
      bytes: pcm8.length,
      appendCount: session.inputAppendCount,
    });

    this.logger.log({
      streamSid: session.streamSid,
      pcm8Bytes: pcm8.length,
      pcm24Bytes: pcm24.length,
      appendCount: session.inputAppendCount,
      speechLike,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      message: 'input_audio_buffer.append sent',
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: now,
      appendCount: session.inputAppendCount,
      lastOpenAiAppendAt: now,
      incrementOpenAiEvent: 'input_audio_buffer.append',
    });

    if (!session.closing && !session.useServerVad && !session.responseInProgress) {
      if (speechLike) {
        this.scheduleInputCommit(session);
      }
      return;
    }

    // With server_vad, OpenAI handles turn detection — manual fallback commits
    // duplicate response.create and cause overlapping / mixed-language replies.
  }

  private flushPendingInput(session: OpenAiRealtimeSession): void {
    if (session.pendingPcm8.length === 0) {
      return;
    }

    const pending = session.pendingPcm8.splice(0);
    this.logger.log({
      streamSid: session.streamSid,
      pendingChunks: pending.length,
      message: 'Flushing queued inbound audio to OpenAI',
    });

    for (const pcm8 of pending) {
      this.appendInputAudio(session, pcm8);
    }
  }

  private scheduleInputCommit(session: OpenAiRealtimeSession): void {
    this.clearCommitTimer(session);
    session.commitTimer = setTimeout(() => {
      void this.commitInputAndCreateResponse(session);
    }, INPUT_COMMIT_DELAY_MS);
  }

  private clearCommitTimer(session: OpenAiRealtimeSession): void {
    if (session.commitTimer) {
      clearTimeout(session.commitTimer);
      session.commitTimer = undefined;
    }
  }

  private scheduleManualFallbackSilenceCommit(session: OpenAiRealtimeSession): void {
    if (session.manualFallbackSilenceTimer) {
      return;
    }

    session.manualFallbackSilenceTimer = setTimeout(() => {
      session.manualFallbackSilenceTimer = undefined;
      if (
        session.closing ||
        !session.manualFallbackSpeechDetected ||
        session.responseRequested ||
        session.responseInProgress
      ) {
        return;
      }

      session.manualFallbackCommitCount += 1;
      this.updateRuntimeState(session.streamSid, {
        manualFallbackCommitCount: session.manualFallbackCommitCount,
      });

      voiceDebugLog(
        this.logger,
        session.streamSid,
        'manual_fallback_commit',
        {
          commitCount: session.commitCount + 1,
          silenceMs: MANUAL_FALLBACK_SILENCE_MS,
        },
        { bypassThrottle: true },
      );

      void this.commitInputAndCreateResponse(session, {
        manualFallback: true,
        reason: 'manual_fallback',
      });
    }, MANUAL_FALLBACK_SILENCE_MS);
  }

  private clearManualFallbackSilenceTimer(session: OpenAiRealtimeSession): void {
    if (session.manualFallbackSilenceTimer) {
      clearTimeout(session.manualFallbackSilenceTimer);
      session.manualFallbackSilenceTimer = undefined;
    }
  }

  private resetResponseGuards(
    session: OpenAiRealtimeSession,
    reason: string,
  ): void {
    if (session.responseRequested || session.responseInProgress) {
      this.logger.log({
        streamSid: session.streamSid,
        reason,
        message: 'Resetting OpenAI response guards',
      });
    }

    session.responseRequested = false;
    session.responseInProgress = false;
    session.outboundMulawBuffer = Buffer.alloc(0);
    session.outboundPcmDownsampler.reset();
    this.updateRuntimeState(session.streamSid, {
      responsePending: false,
      isAwaitingOpenAiResponse: false,
    });
  }

  private async commitInputAndCreateResponse(
    session: OpenAiRealtimeSession,
    options?: { forceOnEnd?: boolean; manualFallback?: boolean; reason?: string },
  ): Promise<void> {
    if (session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const commitReason =
      options?.reason ??
      (options?.manualFallback
        ? 'manual_fallback'
        : session.useServerVad
          ? 'server_vad'
          : 'manual');

    if (session.responseRequested || session.responseInProgress) {
      voiceDebugLog(this.logger, session.streamSid, 'openai_response_create', {
        responseCount: session.responseCreateCount,
        reason: commitReason,
        skipped: 1,
      });
      this.logger.debug({
        streamSid: session.streamSid,
        responseRequested: session.responseRequested,
        responseInProgress: session.responseInProgress,
        reason: commitReason,
        message: 'Skipping response.create — response already pending',
      });
      return;
    }

    if (
      session.useServerVad &&
      !options?.forceOnEnd &&
      !options?.manualFallback
    ) {
      return;
    }

    if (session.totalInputPcm24Sent === 0) {
      this.logger.warn({
        streamSid: session.streamSid,
        pendingChunks: session.pendingPcm8.length,
        message: 'Skipping commit/response.create — no audio sent to OpenAI yet',
      });
      return;
    }

    session.responseRequested = true;
    session.commitCount += 1;
    session.responseCreateCount += 1;
    session.manualFallbackSpeechDetected = false;
    this.clearManualFallbackSilenceTimer(session);

    const now = new Date();
    session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    session.ws.send(JSON.stringify({ type: 'response.create' }));

    voiceDebugLog(this.logger, session.streamSid, 'openai_commit', {
      commitCount: session.commitCount,
      reason: commitReason,
    });
    voiceDebugLog(this.logger, session.streamSid, 'openai_response_create', {
      responseCount: session.responseCreateCount,
      reason: commitReason,
    });

    this.logger.log({
      streamSid: session.streamSid,
      inputAppendCount: session.inputAppendCount,
      commitCount: session.commitCount,
      responseCreateCount: session.responseCreateCount,
      totalInputPcm24Sent: session.totalInputPcm24Sent,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      commitReason,
      message: 'input_audio_buffer.commit and response.create sent',
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: now,
      commitCount: session.commitCount,
      responseCreateCount: session.responseCreateCount,
      lastCommitAt: now,
      lastResponseCreateAt: now,
      responsePending: true,
      isAwaitingOpenAiResponse: true,
      incrementOpenAiEvent: 'input_audio_buffer.commit',
    });
    this.updateRuntimeState(session.streamSid, {
      incrementOpenAiEvent: 'response.create',
    });
  }

  private waitForWebSocketOpen(
    session: OpenAiRealtimeSession,
    timeoutMs: number,
  ): Promise<boolean> {
    if (session.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }
    if (session.ws.readyState === WebSocket.CLOSED) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(session.ws.readyState === WebSocket.OPEN);
      }, timeoutMs);

      session.ws.once('open', () => {
        clearTimeout(timer);
        resolve(true);
      });
      session.ws.once('close', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  private waitForResponseComplete(
    session: OpenAiRealtimeSession,
    timeoutMs: number,
  ): Promise<void> {
    if (session.responseComplete || !session.responseRequested) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn({
          streamSid: session.streamSid,
          timeoutMs,
          totalOutputMulawSent: session.totalOutputMulawSent,
          message: 'Timed out waiting for OpenAI response.done',
        });
        resolve();
      }, timeoutMs);

      session.responseWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private resolveResponseWaiters(session: OpenAiRealtimeSession): void {
    const waiters = session.responseWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private handleServerMessage(
    streamSid: string,
    data: Buffer | ArrayBuffer | Buffer[],
  ): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(
        Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      this.logger.warn({ streamSid, message: 'Invalid JSON from OpenAI Realtime' });
      return;
    }

    const type = event.type;
    if (typeof type !== 'string') {
      return;
    }

    const session = this.sessions.get(streamSid);
    if (!session) {
      return;
    }

    this.updateRuntimeState(streamSid, {
      runtimeLastEventAt: new Date(),
    });

    const isImportant =
      type === 'error' ||
      type.includes('session') ||
      type.includes('response') ||
      type.includes('audio') ||
      type.includes('buffer') ||
      type.includes('speech');

    if (isImportant) {
      this.logger.log({ streamSid, openaiEvent: type, eventId: event.event_id });
      voiceDebugLog(this.logger, streamSid, 'openai_event', { event: type });
      this.updateRuntimeState(streamSid, {
        incrementOpenAiEvent: type,
        lastOpenAiEvent: type,
      });
    }

    if (type === 'session.updated' || type === 'session.created') {
      session.sessionReady = true;
      const sessionPayload = asRecord(event.session);
      if (sessionPayload) {
        const outputFormat = parseOpenAiOutputAudioFormat(sessionPayload);
        if (outputFormat !== session.outputAudioFormat) {
          session.outputAudioFormat = outputFormat;
          this.logger.log({
            streamSid,
            outputAudioFormat: outputFormat,
            openaiEvent: type,
            message: 'OpenAI output audio format detected',
          });
        }
      }
      if (type === 'session.updated') {
        this.tryStartOpeningGreeting(session);
        this.flushPendingInputIfReady(session);
      }
    }

    if (type === 'input_audio_buffer.speech_started') {
      const now = new Date();
      session.manualFallbackSpeechDetected = true;
      this.clearManualFallbackSilenceTimer(session);
      this.updateRuntimeState(streamSid, {
        lastSpeechLikeAudioAt: now,
        lastSpeechStartedAt: now,
      });
      return;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      const now = new Date();
      this.logger.log({
        streamSid,
        turnDetection: session.useServerVad ? 'server_vad' : 'manual',
        message: 'OpenAI detected end of caller speech',
      });
      this.updateRuntimeState(streamSid, {
        lastSpeechStoppedAt: now,
      });
      return;
    }

    if (type === 'input_audio_buffer.committed') {
      const now = new Date();
      this.logger.log({
        streamSid,
        message: 'OpenAI input_audio_buffer.committed',
      });
      this.updateRuntimeState(streamSid, {
        lastCommitAt: now,
      });
      return;
    }

    if (type === 'error') {
      const error = asRecord(event.error);
      const message =
        typeof error?.message === 'string'
          ? error.message
          : JSON.stringify(event.error ?? event);
      this.logger.error({ streamSid, error: event.error ?? event }, message);
      if (session.openingGreetingPending) {
        session.openingGreetingPending = false;
        this.logger.error({
          streamSid,
          error: message,
          message: 'voice_opening_greeting_error',
        });
        this.voiceSessionService.updateOpeningState(streamSid, {
          openingGreetingError: message,
        });
        this.completeOpeningGreeting(session);
      }
      this.resetResponseGuards(session, 'openai_error_event');
      this.clearManualFallbackSilenceTimer(session);
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeError: message,
        lastError: message,
      });
      return;
    }

    if (type === 'response.cancelled') {
      this.resetResponseGuards(session, 'response_cancelled');
      this.clearManualFallbackSilenceTimer(session);
      this.updateRuntimeState(streamSid, {
        isAiSpeaking: false,
        lastOpenAiEvent: type,
      });
      return;
    }

    if (type === 'response.created') {
      session.responseInProgress = true;
      session.responseComplete = false;
      session.responseCount += 1;
      session.outboundPcmDownsampler.reset();
      session.outboundMulawBuffer = Buffer.alloc(0);

      if (session.openingGreetingPending) {
        const now = new Date();
        session.openingGreetingPending = false;
        this.logger.log({
          streamSid,
          message: 'voice_opening_greeting_sent',
        });
        voiceDebugLog(
          this.logger,
          streamSid,
          'voice_opening_greeting_sent',
          { responseCount: session.responseCount },
          { bypassThrottle: true },
        );
        this.voiceSessionService.updateOpeningState(streamSid, {
          openingGreetingResponseCreatedAt: now,
        });
      }

      this.updateRuntimeState(streamSid, {
        responseCount: session.responseCount,
        responsePending: true,
        isAwaitingOpenAiResponse: true,
        isAiSpeaking: true,
      });
      return;
    }

    if (isOpenAiOutputAudioDeltaEvent(type) || type.includes('output_audio.delta')) {
      const delta = extractAudioDelta(event);
      if (!delta) {
        this.logger.warn({ streamSid, openaiEvent: type, message: 'Audio delta event without payload' });
        return;
      }
      this.handleOutputAudioDelta(session, delta);
      return;
    }

    if (type === 'response.output_audio.done' || type === 'response.audio.done') {
      this.flushOutboundPcmRemainder(session);
      this.flushRemainingOutbound(session);
      this.logger.log({
        streamSid,
        totalOutputMulawSent: session.totalOutputMulawSent,
        outboundMediaCount: session.outboundMediaCount,
        message: 'response.output_audio.done received',
      });
      this.updateRuntimeState(streamSid, { isAiSpeaking: false });
      return;
    }

    if (type === 'response.done') {
      session.responseInProgress = false;
      session.responseComplete = true;
      session.responseRequested = false;
      session.responseDoneCount += 1;
      session.manualFallbackSpeechDetected = false;
      if (session.openingGreetingRequested && !session.openingGreetingComplete) {
        this.completeOpeningGreeting(session);
      }
      this.clearManualFallbackSilenceTimer(session);
      this.flushOutboundPcmRemainder(session);
      this.flushRemainingOutbound(session);
      this.resolveResponseWaiters(session);
      const now = new Date();
      this.logger.log({
        streamSid,
        totalOutputMulawSent: session.totalOutputMulawSent,
        outboundMediaCount: session.outboundMediaCount,
        responseCount: session.responseCount,
        responseDoneCount: session.responseDoneCount,
        message: 'response.done received',
      });
      this.updateRuntimeState(streamSid, {
        isAwaitingOpenAiResponse: false,
        isAiSpeaking: false,
        responsePending: false,
        responseDoneCount: session.responseDoneCount,
        lastResponseDoneAt: now,
      });
    }
  }

  private handleOutputAudioDelta(
    session: OpenAiRealtimeSession,
    base64Delta: string,
  ): void {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(base64Delta, 'base64');
    } catch (error) {
      this.logger.warn(
        { streamSid: session.streamSid, err: error },
        'Invalid OpenAI audio delta',
      );
      return;
    }

    if (decoded.length === 0) {
      return;
    }

    voiceDebugLog(this.logger, session.streamSid, 'openai_audio_delta', {
      bytes: decoded.length,
      format: session.outputAudioFormat,
    });

    if (session.outputAudioFormat === 'g711_ulaw') {
      this.appendOutboundMulaw(session, decoded, {
        sourceBytes: decoded.length,
        passthrough: true,
      });
      return;
    }

    if (decoded.length % 2 !== 0) {
      this.logger.warn({
        streamSid: session.streamSid,
        pcm24Bytes: decoded.length,
        message: 'OpenAI PCM audio delta has odd byte length; dropping',
      });
      return;
    }

    const openAiStats = analyzePcm16(decoded);
    const pcm8 = session.outboundPcmDownsampler.push(decoded);
    if (pcm8.length === 0) {
      return;
    }

    const pcm8Prepared = prepareOutboundPcm16(pcm8, LIVE_OUTBOUND_PCM_OPTIONS);
    const encodeInputStats = analyzePcm16(pcm8Prepared);

    if (!this.loggedOpenAiOutputByStreamSid.has(session.streamSid)) {
      this.loggedOpenAiOutputByStreamSid.add(session.streamSid);
      this.logger.log({
        streamSid: session.streamSid,
        outputAudioFormat: session.outputAudioFormat,
        openAiPcm24: formatPcm16Stats(openAiStats),
        pcm8AfterDownsample: formatPcm16Stats(analyzePcm16(pcm8)),
        pcm8PreparedForMulaw: formatPcm16Stats(encodeInputStats),
        outboundChunkBytes: session.outboundChunkBytes,
        liveGain: LIVE_OUTBOUND_PCM_OPTIONS.gain,
        liveAutoNormalize: LIVE_OUTBOUND_PCM_OPTIONS.autoNormalize,
        message: 'OpenAI output audio level stats (first delta)',
      });
    }

    this.voiceSessionService.recordOutboundAudioStats(
      session.streamSid,
      encodeInputStats,
    );
    this.voiceSessionService.setAudioGainApplied(
      session.streamSid,
      LIVE_OUTBOUND_PCM_OPTIONS.gain,
    );

    const mulaw = encodePcm16ToMulaw(pcm8Prepared);
    this.appendOutboundMulaw(session, mulaw, {
      sourceBytes: decoded.length,
      pcm8Bytes: pcm8.length,
      openAiPeak: openAiStats.peak,
      openAiRms: Number(openAiStats.rms.toFixed(2)),
      outboundPeak: encodeInputStats.peak,
      outboundRms: Number(encodeInputStats.rms.toFixed(2)),
    });
  }

  private appendOutboundMulaw(
    session: OpenAiRealtimeSession,
    mulaw: Buffer,
    logFields: Record<string, number | boolean | undefined>,
  ): void {
    session.outboundMulawBuffer = Buffer.concat([
      session.outboundMulawBuffer,
      mulaw,
    ]);

    this.logger.log({
      streamSid: session.streamSid,
      mulawBytes: mulaw.length,
      bufferedMulawBytes: session.outboundMulawBuffer.length,
      outputAudioFormat: session.outputAudioFormat,
      ...logFields,
      message: 'response.output_audio.delta received',
    });

    this.updateRuntimeState(session.streamSid, {
      lastOpenAiAudioAt: new Date(),
      isAiSpeaking: true,
      incrementOpenAiEvent: 'response.output_audio.delta',
    });

    this.flushOutboundMulaw(session);
  }

  private flushOutboundPcmRemainder(session: OpenAiRealtimeSession): void {
    const pcm8 = session.outboundPcmDownsampler.flush();
    if (pcm8.length === 0) {
      return;
    }

    const pcm8Prepared = prepareOutboundPcm16(pcm8, LIVE_OUTBOUND_PCM_OPTIONS);
    const mulaw = encodePcm16ToMulaw(pcm8Prepared);
    session.outboundMulawBuffer = Buffer.concat([
      session.outboundMulawBuffer,
      mulaw,
    ]);
    this.logger.log({
      streamSid: session.streamSid,
      pcm8Bytes: pcm8.length,
      mulawBytes: mulaw.length,
      message: 'Flushed remaining OpenAI PCM through downsampler',
    });
  }

  private flushOutboundMulaw(session: OpenAiRealtimeSession): void {
    const chunkBytes = session.outboundChunkBytes;
    while (session.outboundMulawBuffer.length >= chunkBytes) {
      const frame = session.outboundMulawBuffer.subarray(0, chunkBytes);
      session.outboundMulawBuffer = session.outboundMulawBuffer.subarray(
        chunkBytes,
      );
      const payload = frame.toString('base64');
      session.totalOutputMulawSent += frame.length;
      session.outboundMediaCount += 1;
      this.sendOutboundMedia(
        session.streamSid,
        payload,
        frame.length,
        session.outboundMediaCount,
      );
      this.updateRuntimeState(session.streamSid, {
        outboundMediaCount: session.outboundMediaCount,
      });
    }
  }

  private flushRemainingOutbound(session: OpenAiRealtimeSession): void {
    if (session.outboundMulawBuffer.length === 0) {
      return;
    }

    const chunkBytes = session.outboundChunkBytes;
    const remainder = session.outboundMulawBuffer.length;
    const partial = remainder % chunkBytes;
    if (partial !== 0) {
      const paddingLength = chunkBytes - partial;
      session.outboundMulawBuffer = Buffer.concat([
        session.outboundMulawBuffer,
        Buffer.alloc(paddingLength, MULAW_SILENCE_BYTE),
      ]);
    }

    const beforeFlushBytes = session.outboundMulawBuffer.length;
    this.flushOutboundMulaw(session);
    this.logger.log({
      streamSid: session.streamSid,
      remainderBytes: remainder,
      paddedTotalBytes: beforeFlushBytes,
      outboundChunkBytes: chunkBytes,
      message: 'Flushed final padded outbound frame',
    });
  }

  private sendOutboundMedia(
    streamSid: string,
    base64MulawPayload: string,
    mulawBytes: number,
    outboundMediaCount?: number,
  ): void {
    voiceDebugLog(this.logger, streamSid, 'outbound_audio_chunk', {
      bytes: mulawBytes,
      outboundMediaCount,
    });
    voiceDebugLog(this.logger, streamSid, 'smartflo_send_media', {
      bytes: mulawBytes,
      outboundMediaCount,
    });
    voiceDebugLog(this.logger, streamSid, 'outbound_chunk_bytes', {
      bytes: mulawBytes,
    });

    this.logger.log({
      streamSid,
      mulawBytes,
      base64Length: base64MulawPayload.length,
      outboundMediaCount,
      message: 'Sending outbound media to Smartflo via AudioGateway',
    });

    this.audioGateway.sendMedia(streamSid, base64MulawPayload);
  }

  private updateRuntimeState(
    streamSid: string,
    update: {
      runtimeProvider?: string;
      runtimeStatus?: VoiceRuntimeStatus;
      runtimeConnectedAt?: Date;
      runtimeLastEventAt?: Date;
      runtimeError?: string;
      isOpenAiConnected?: boolean;
      hasReceivedCallerAudio?: boolean;
      lastCallerAudioAt?: Date;
      lastMediaAt?: Date;
      lastSpeechLikeAudioAt?: Date;
      lastOpenAiAppendAt?: Date;
      lastSpeechStartedAt?: Date;
      lastSpeechStoppedAt?: Date;
      lastCommitAt?: Date;
      lastResponseCreateAt?: Date;
      lastResponseDoneAt?: Date;
      lastOpenAiEvent?: string;
      lastError?: string;
      responsePending?: boolean;
      isAwaitingOpenAiResponse?: boolean;
      isAiSpeaking?: boolean;
      lastOpenAiAudioAt?: Date;
      responseCount?: number;
      responseCreateCount?: number;
      responseDoneCount?: number;
      appendCount?: number;
      commitCount?: number;
      outboundMediaCount?: number;
      manualFallbackCommitCount?: number;
      incrementOpenAiEvent?: string;
    },
  ): void {
    this.voiceSessionService.updateRuntimeState(streamSid, update);
  }
}
