import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket } from 'ws';
import { encodePcm16ToMulaw, decodeMulawBuffer } from '../audio/mulaw-codec';
import { applyPcm16Gain } from '../audio/audio-gain.util';
import { resamplePcm16 } from '../audio/pcm-resampler';
import { analyzePcm16, formatPcm16Stats } from '../audio/pcm-stats.util';
import { isSpeechLikePcm16 } from '../audio/speech-detection.util';
import { VoiceAudioConfigService } from '../audio/voice-audio-config.service';
import { AudioGateway } from '../audio.gateway';
import { VoiceSessionService } from '../voice-session.service';
import {
  buildGaSessionUpdate,
  buildRealtimeWsHeaders,
  isOpenAiOutputAudioDeltaEvent,
  OpenAiTurnDetectionMode,
  OPENAI_REALTIME_SAMPLE_RATE,
} from './openai-realtime-ga.util';
import {
  VoiceRuntimeProvider,
  VoiceRuntimeSessionContext,
  VoiceRuntimeStatus,
} from './voice-runtime.provider';

const SMARTFLO_SAMPLE_RATE = 8000;
const OPENAI_SAMPLE_RATE = OPENAI_REALTIME_SAMPLE_RATE;
const MULAW_FRAME_BYTES = 160;
const MULAW_SILENCE_BYTE = 0xff;
const INPUT_COMMIT_DELAY_MS = 600;
const RESPONSE_WAIT_MS = 15000;
const SESSION_READY_TIMEOUT_MS = 5000;
const WS_OPEN_TIMEOUT_MS = 8000;

const DEFAULT_INSTRUCTIONS =
  'You are a helpful voice assistant on a phone call. Keep responses concise and conversational.';

interface OpenAiRealtimeSession {
  streamSid: string;
  ws: WebSocket;
  status: VoiceRuntimeStatus;
  connectedAt?: Date;
  sessionReady: boolean;
  outboundMulawBuffer: Buffer;
  pendingPcm8: Buffer[];
  closing: boolean;
  commitTimer?: NodeJS.Timeout;
  responseRequested: boolean;
  responseInProgress: boolean;
  responseComplete: boolean;
  responseWaiters: Array<() => void>;
  totalInputPcm24Sent: number;
  totalOutputMulawSent: number;
  inputAppendCount: number;
  commitCount: number;
  responseCount: number;
  outboundMediaCount: number;
  lastCloseCode?: number;
  lastCloseReason?: string;
  useServerVad: boolean;
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

    const session: OpenAiRealtimeSession = {
      streamSid,
      ws,
      status: 'connecting',
      sessionReady: false,
      outboundMulawBuffer: Buffer.alloc(0),
      pendingPcm8: [],
      closing: false,
      responseRequested: false,
      responseInProgress: false,
      responseComplete: false,
      responseWaiters: [],
      totalInputPcm24Sent: 0,
      totalOutputMulawSent: 0,
      inputAppendCount: 0,
      commitCount: 0,
      responseCount: 0,
      outboundMediaCount: 0,
      useServerVad,
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
      this.sendSessionUpdate(ws, model, useServerVad);
      this.logger.log({
        streamSid,
        model,
        turnDetection: useServerVad ? 'server_vad' : 'manual',
        message: 'OpenAI Realtime WebSocket open',
      });

      setTimeout(() => {
        if (!session.sessionReady && !session.closing) {
          session.sessionReady = true;
          this.flushPendingInput(session);
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
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeLastEventAt: new Date(),
        runtimeError: error.message,
      });
      this.resolveResponseWaiters(session);
    });

    ws.on('close', (code, reason) => {
      session.status = 'closed';
      session.lastCloseCode = code;
      session.lastCloseReason = reason.toString();
      this.clearCommitTimer(session);
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
    });
  }

  private sendSessionUpdate(
    ws: WebSocket,
    model: string,
    useServerVad: boolean,
  ): void {
    const voice =
      this.configService.get<string>('OPENAI_REALTIME_VOICE')?.trim() ?? 'alloy';
    const instructions =
      this.configService.get<string>('OPENAI_REALTIME_INSTRUCTIONS')?.trim() ??
      DEFAULT_INSTRUCTIONS;

    const payload = buildGaSessionUpdate({
      voice,
      instructions,
      model,
      turnDetection: useServerVad ? 'server_vad' : 'manual',
    });

    this.logger.log({
      voice,
      model,
      turnDetection: useServerVad ? 'server_vad' : 'manual',
      message: 'Sending OpenAI GA session.update',
    });
    ws.send(JSON.stringify(payload));
  }

  private appendInputAudio(session: OpenAiRealtimeSession, pcm8: Buffer): void {
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
      incrementOpenAiEvent: 'input_audio_buffer.append',
    });

    if (!session.closing && !session.useServerVad && !session.responseInProgress) {
      if (speechLike) {
        this.scheduleInputCommit(session);
      }
    }
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

  private async commitInputAndCreateResponse(
    session: OpenAiRealtimeSession,
    options?: { forceOnEnd?: boolean },
  ): Promise<void> {
    if (session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (
      session.responseRequested ||
      session.responseInProgress ||
      (session.useServerVad && !options?.forceOnEnd)
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

    session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    session.ws.send(JSON.stringify({ type: 'response.create' }));

    this.logger.log({
      streamSid: session.streamSid,
      inputAppendCount: session.inputAppendCount,
      commitCount: session.commitCount,
      totalInputPcm24Sent: session.totalInputPcm24Sent,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      message: 'input_audio_buffer.commit and response.create sent',
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: new Date(),
      commitCount: session.commitCount,
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
      this.updateRuntimeState(streamSid, { incrementOpenAiEvent: type });
    }

    if (type === 'session.updated' || type === 'session.created') {
      session.sessionReady = true;
      if (type === 'session.updated') {
        this.flushPendingInput(session);
      }
    }

    if (type === 'input_audio_buffer.speech_started') {
      this.updateRuntimeState(streamSid, {
        lastSpeechLikeAudioAt: new Date(),
      });
      return;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      this.logger.log({
        streamSid,
        turnDetection: session.useServerVad ? 'server_vad' : 'manual',
        message: 'OpenAI detected end of caller speech',
      });
      return;
    }

    if (type === 'input_audio_buffer.committed') {
      this.logger.log({
        streamSid,
        message: 'OpenAI input_audio_buffer.committed',
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
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeError: message,
      });
      return;
    }

    if (type === 'response.created') {
      session.responseInProgress = true;
      session.responseComplete = false;
      session.responseCount += 1;
      this.updateRuntimeState(streamSid, {
        responseCount: session.responseCount,
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
      this.flushRemainingOutbound(session);
      this.resolveResponseWaiters(session);
      this.logger.log({
        streamSid,
        totalOutputMulawSent: session.totalOutputMulawSent,
        outboundMediaCount: session.outboundMediaCount,
        responseCount: session.responseCount,
        message: 'response.done received',
      });
      this.updateRuntimeState(streamSid, {
        isAwaitingOpenAiResponse: false,
        isAiSpeaking: false,
      });
    }
  }

  private handleOutputAudioDelta(
    session: OpenAiRealtimeSession,
    base64Pcm24: string,
  ): void {
    let pcm24: Buffer;
    try {
      pcm24 = Buffer.from(base64Pcm24, 'base64');
    } catch (error) {
      this.logger.warn(
        { streamSid: session.streamSid, err: error },
        'Invalid OpenAI audio delta',
      );
      return;
    }

    if (pcm24.length === 0) {
      return;
    }

    const pcm8 = resamplePcm16(
      pcm24,
      OPENAI_SAMPLE_RATE,
      SMARTFLO_SAMPLE_RATE,
    );

    const openAiStats = analyzePcm16(pcm24);
    const pcm8Stats = analyzePcm16(pcm8);
    const gain = this.voiceAudioConfigService.getGain();
    const pcm8ForEncode = gain !== 1 ? applyPcm16Gain(pcm8, gain) : pcm8;
    const encodeInputStats = analyzePcm16(pcm8ForEncode);

    if (!this.loggedOpenAiOutputByStreamSid.has(session.streamSid)) {
      this.loggedOpenAiOutputByStreamSid.add(session.streamSid);
      this.logger.log({
        streamSid: session.streamSid,
        openAiPcm24: formatPcm16Stats(openAiStats),
        pcm8AfterResample: formatPcm16Stats(pcm8Stats),
        pcm8BeforeMulawEncode: formatPcm16Stats(encodeInputStats),
        gain,
        message: 'OpenAI output audio level stats (first delta)',
      });
    }

    this.voiceSessionService.recordOutboundAudioStats(
      session.streamSid,
      encodeInputStats,
    );
    this.voiceSessionService.setAudioGainApplied(session.streamSid, gain);

    const mulaw = encodePcm16ToMulaw(pcm8ForEncode);
    const mulawRoundtripStats = analyzePcm16(decodeMulawBuffer(mulaw));
    if (!this.loggedOpenAiOutputByStreamSid.has(`${session.streamSid}:mulaw`)) {
      this.loggedOpenAiOutputByStreamSid.add(`${session.streamSid}:mulaw`);
      this.logger.log({
        streamSid: session.streamSid,
        mulawEncodeRoundtrip: formatPcm16Stats(mulawRoundtripStats),
        message: 'Outbound μ-law encode roundtrip stats (first delta)',
      });
    }

    session.outboundMulawBuffer = Buffer.concat([
      session.outboundMulawBuffer,
      mulaw,
    ]);

    this.logger.log({
      streamSid: session.streamSid,
      pcm24Bytes: pcm24.length,
      pcm8Bytes: pcm8.length,
      mulawBytes: mulaw.length,
      openAiPeak: openAiStats.peak,
      openAiRms: Number(openAiStats.rms.toFixed(2)),
      outboundPeak: encodeInputStats.peak,
      outboundRms: Number(encodeInputStats.rms.toFixed(2)),
      gain,
      message: 'response.output_audio.delta received',
    });

    this.updateRuntimeState(session.streamSid, {
      lastOpenAiAudioAt: new Date(),
      isAiSpeaking: true,
      incrementOpenAiEvent: 'response.output_audio.delta',
    });

    this.flushOutboundMulaw(session);
  }

  private flushOutboundMulaw(session: OpenAiRealtimeSession): void {
    while (session.outboundMulawBuffer.length >= MULAW_FRAME_BYTES) {
      const frame = session.outboundMulawBuffer.subarray(0, MULAW_FRAME_BYTES);
      session.outboundMulawBuffer = session.outboundMulawBuffer.subarray(
        MULAW_FRAME_BYTES,
      );
      const payload = frame.toString('base64');
      session.totalOutputMulawSent += frame.length;
      session.outboundMediaCount += 1;
      this.sendOutboundMedia(session.streamSid, payload, frame.length);
      this.updateRuntimeState(session.streamSid, {
        outboundMediaCount: session.outboundMediaCount,
      });
    }
  }

  private flushRemainingOutbound(session: OpenAiRealtimeSession): void {
    if (session.outboundMulawBuffer.length === 0) {
      return;
    }

    const remainder = session.outboundMulawBuffer.length;
    const paddingLength = MULAW_FRAME_BYTES - remainder;
    session.outboundMulawBuffer = Buffer.concat([
      session.outboundMulawBuffer,
      Buffer.alloc(paddingLength, MULAW_SILENCE_BYTE),
    ]);
    this.flushOutboundMulaw(session);
    this.logger.log({
      streamSid: session.streamSid,
      remainderBytes: remainder,
      message: 'Flushed final padded outbound frame',
    });
  }

  private sendOutboundMedia(
    streamSid: string,
    base64MulawPayload: string,
    mulawBytes: number,
  ): void {
    this.logger.log({
      streamSid,
      mulawBytes,
      base64Length: base64MulawPayload.length,
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
      lastSpeechLikeAudioAt?: Date;
      isAwaitingOpenAiResponse?: boolean;
      isAiSpeaking?: boolean;
      lastOpenAiAudioAt?: Date;
      responseCount?: number;
      appendCount?: number;
      commitCount?: number;
      outboundMediaCount?: number;
      incrementOpenAiEvent?: string;
    },
  ): void {
    this.voiceSessionService.updateRuntimeState(streamSid, update);
  }
}
