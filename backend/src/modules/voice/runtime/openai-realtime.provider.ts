import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket } from 'ws';
import {
  AgentPlaybookService,
  RuntimeAgentPlaybook,
} from '../../training/agent-playbook.service';
import { encodePcm16ToMulaw } from '../audio/mulaw-codec';
import { prepareOutboundPcm16 } from '../audio/audio-gain.util';
import { Pcm16StreamDownsampler, resamplePcm16 } from '../audio/pcm-resampler';
import { analyzePcm16, formatPcm16Stats } from '../audio/pcm-stats.util';
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
  buildDefaultRealtimeInstructions,
  buildOpeningResponseInstructions,
  buildOpeningSessionInstructions,
  buildPostOpeningSessionInstructions,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  OPENING_MAX_OUTPUT_TOKENS,
} from '../voice-opening.util';
import {
  DEFAULT_REALTIME_VOICE,
  parseVoiceAccent,
} from '../voice-accent.util';
import { VoiceTranscriptConfigService } from '../transcript/voice-transcript-config.service';
import { buildRealtimeTranscriptionPrompt } from '../transcript/voice-transcript-prompt.util';
import { VoiceTranscriptService } from '../transcript/voice-transcript.service';
import { buildVoiceRuntimeInstructions } from '../voice-runtime-instructions.util';

const SMARTFLO_SAMPLE_RATE = 8000;
const OPENAI_SAMPLE_RATE = OPENAI_REALTIME_SAMPLE_RATE;
const MULAW_SILENCE_BYTE = 0xff;
const INPUT_COMMIT_DELAY_MS = 600;
const MANUAL_FALLBACK_SILENCE_MS = 800;
const RESPONSE_WAIT_MS = 15000;
const SESSION_READY_TIMEOUT_MS = 5000;
const WS_OPEN_TIMEOUT_MS = 8000;
const PLAYBOOK_LOOKUP_TIMEOUT_MS = 750;
const DEFAULT_POST_OPENING_INPUT_IGNORE_MS = 300;
const DEFAULT_POST_OPENING_SPEECH_GATE_MAX_MS = 1200;
const DEFAULT_SPEECH_RMS_THRESHOLD = 0.015;
const DEFAULT_AI_COMPLETION_HANGUP_DELAY_MS = 1500;
const DEFAULT_AI_COMPLETION_HANGUP_MAX_WAIT_MS = 6000;

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
  hangupTimer?: NodeJS.Timeout;
  callEndMaxWaitTimer?: NodeJS.Timeout;
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
  activePlaybook?: RuntimeAgentPlaybook | null;
  playbookLookupComplete: boolean;
  playbookLoadError?: string;
  ignoreInboundAudioUntilMs?: number;
  requireSpeechLikeUntilMs?: number;
  acceptedCallerAudioAfterOpening: boolean;
  inboundSuppressedCount: number;
  inboundSuppressedReason?: string;
  speechLikePacketCount: number;
  ignoredSpeechPacketCount: number;
  activeInstructionsMode?: 'opening' | 'normal';
  callEndDetected: boolean;
  callEndReason?: string;
  callEndScheduledAt?: Date;
  callEndCloseAt?: Date;
  callEndCloseError?: string;
  openingGreetingRequested: boolean;
  openingGreetingPending: boolean;
  openingGreetingComplete: boolean;
  openingCompletedAt?: Date;
  assistantTranscriptBuffer: string;
  lastAssistantTranscript?: string;
  assistantTranscriptItemId?: string;
}

function normalizeTranscriptForIntent(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldEndCallAfterAssistantText(text: string): boolean {
  const normalized = normalizeTranscriptForIntent(text);
  if (!normalized) {
    return false;
  }

  const thanked =
    /\b(thank you|thanks|thankyou|appreciate)\b/.test(normalized) ||
    /(धन्यवाद|शुक्रिया|थैंक\s*यू)/.test(normalized);
  const feedback =
    /\b(feedback|review|response|input|sharing|experience)\b/.test(
      normalized,
    ) || /(फीडबैक|प्रतिक्रिया|अनुभव)/.test(normalized);
  const farewell =
    /\b(have a nice day|have a good day|goodbye|bye|take care)\b/.test(
      normalized,
    ) || /(अच्छा\s*दिन|नमस्ते|अलविदा)/.test(normalized);

  return thanked && (feedback || farewell);
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

function extractTranscriptDelta(event: Record<string, unknown>): string | undefined {
  const direct = event.delta;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  const transcript = asRecord(event.transcript);
  if (typeof transcript?.delta === 'string' && transcript.delta.length > 0) {
    return transcript.delta;
  }

  return undefined;
}

function extractTranscriptText(event: Record<string, unknown>): string | undefined {
  const direct = event.transcript;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const transcript = asRecord(event.transcript);
  if (typeof transcript?.text === 'string' && transcript.text.trim().length > 0) {
    return transcript.text.trim();
  }

  return undefined;
}

function extractEventItemId(event: Record<string, unknown>): string | undefined {
  if (typeof event.item_id === 'string') {
    return event.item_id;
  }

  const item = asRecord(event.item);
  if (typeof item?.id === 'string') {
    return item.id;
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
    private readonly voiceTranscriptConfig: VoiceTranscriptConfigService,
    private readonly voiceTranscriptService: VoiceTranscriptService,
    private readonly agentPlaybookService: AgentPlaybookService,
  ) {}

  private getTurnDetectionMode(): OpenAiTurnDetectionMode {
    const raw = this.configService
      .get<string>('OPENAI_REALTIME_TURN_DETECTION')
      ?.trim()
      .toLowerCase();
    return raw === 'manual' ? 'manual' : 'server_vad';
  }

  private readBoolean(name: string, fallback: boolean): boolean {
    const raw = this.configService.get<string>(name);
    if (raw === undefined) {
      return fallback;
    }
    return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  private readInt(name: string, fallback: number, min = 0): number {
    const raw = this.configService.get<string>(name);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? Math.max(parsed, min) : fallback;
  }

  private readFloat(name: string, fallback: number, min = 0): number {
    const raw = this.configService.get<string>(name);
    const parsed = Number.parseFloat(raw ?? '');
    return Number.isFinite(parsed) ? Math.max(parsed, min) : fallback;
  }

  private getPostOpeningIgnoreMs(): number {
    return this.readInt(
      'VOICE_OPENING_IGNORE_MS',
      DEFAULT_POST_OPENING_INPUT_IGNORE_MS,
    );
  }

  private getPostOpeningSpeechGateMaxMs(): number {
    return this.readInt(
      'VOICE_OPENING_SPEECH_GATE_MAX_MS',
      DEFAULT_POST_OPENING_SPEECH_GATE_MAX_MS,
    );
  }

  private isSpeechDetectionEnabled(): boolean {
    return this.readBoolean('VOICE_SPEECH_DETECTION_ENABLED', true);
  }

  private getSpeechRmsThreshold(): number {
    return this.readFloat(
      'VOICE_SPEECH_RMS_THRESHOLD',
      DEFAULT_SPEECH_RMS_THRESHOLD,
    );
  }

  private isAutoEndCallEnabled(): boolean {
    return this.readBoolean('VOICE_AUTO_END_CALL_ENABLED', true);
  }

  private getAutoEndCallDelayMs(): number {
    return this.readInt(
      'VOICE_AUTO_END_CALL_DELAY_MS',
      DEFAULT_AI_COMPLETION_HANGUP_DELAY_MS,
    );
  }

  private getAutoEndCallMaxWaitMs(): number {
    return this.readInt(
      'VOICE_AUTO_END_CALL_MAX_WAIT_MS',
      DEFAULT_AI_COMPLETION_HANGUP_MAX_WAIT_MS,
    );
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
      activePlaybook: null,
      playbookLookupComplete: false,
      acceptedCallerAudioAfterOpening: false,
      inboundSuppressedCount: 0,
      speechLikePacketCount: 0,
      ignoredSpeechPacketCount: 0,
      activeInstructionsMode: context.openingContext ? 'opening' : 'normal',
      callEndDetected: false,
      openingGreetingRequested: false,
      openingGreetingPending: false,
      openingGreetingComplete: false,
      assistantTranscriptBuffer: '',
      lastAssistantTranscript: undefined,
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
      void this.sendSessionUpdate(session, model);
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
      this.clearHangupTimer(session);
      this.clearCallEndMaxWaitTimer(session);
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
    this.clearHangupTimer(session);
    this.clearCallEndMaxWaitTimer(session);
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

  private async sendSessionUpdate(
    session: OpenAiRealtimeSession,
    model: string,
    phase: 'opening' | 'conversation' = 'opening',
  ): Promise<void> {
    const voice =
      this.configService.get<string>('OPENAI_REALTIME_VOICE')?.trim() ??
      DEFAULT_REALTIME_VOICE;
    const accent = parseVoiceAccent(
      this.configService.get<string>('VOICE_ACCENT'),
    );
    const envInstructions =
      this.configService.get<string>('OPENAI_REALTIME_INSTRUCTIONS')?.trim();
    const resolvedDefault = buildDefaultRealtimeInstructions(accent);
    const baseInstructions = session.openingContext
      ? phase === 'opening'
        ? buildOpeningSessionInstructions(
            session.openingContext,
            envInstructions,
            accent,
          )
        : buildPostOpeningSessionInstructions(
            session.openingContext,
            envInstructions,
            accent,
          )
      : (envInstructions ?? resolvedDefault);
    const activePlaybook =
      phase === 'conversation' || !session.openingContext
        ? await this.resolveActivePlaybookForSession(session)
        : null;
    session.activeInstructionsMode = phase === 'opening' ? 'opening' : 'normal';
    const instructions = buildVoiceRuntimeInstructions({
      baseInstructions,
      activePlaybook,
    });

    const payload = buildGaSessionUpdate({
      voice,
      instructions,
      model,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      maxResponseOutputTokens:
        phase === 'conversation' && session.openingContext
          ? CONVERSATION_MAX_OUTPUT_TOKENS
          : undefined,
      ...(this.voiceTranscriptConfig.isRealtimeEnabled()
        ? {
            inputTranscription: {
              model: this.voiceTranscriptConfig.getRealtimeModel(),
              language: this.voiceTranscriptConfig.getLanguageHint(),
              prompt: buildRealtimeTranscriptionPrompt(
                this.voiceTranscriptConfig.getGlossaryTerms(),
              ),
            },
          }
        : {}),
    });

    this.logger.log({
      streamSid: session.streamSid,
      voice,
      model,
      phase,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      hasOpeningContext: Boolean(session.openingContext),
      agentName: session.openingContext?.agentName,
      activePlaybookId: activePlaybook?.id,
      activePlaybookVersion: activePlaybook?.version,
      playbookInjected: Boolean(activePlaybook),
      activeInstructionsMode: session.activeInstructionsMode,
      message: 'voice_runtime_instructions_normalized',
    });
    this.updateRuntimeState(session.streamSid, {
      activeInstructionsMode: session.activeInstructionsMode,
      playbookInjected: Boolean(activePlaybook),
      activePlaybookId: activePlaybook?.id,
      activePlaybookVersion: activePlaybook?.version,
    });
    session.ws.send(JSON.stringify(payload));
  }

  private async resolveActivePlaybookForSession(
    session: OpenAiRealtimeSession,
  ): Promise<RuntimeAgentPlaybook | null> {
    if (session.playbookLookupComplete) {
      return session.activePlaybook ?? null;
    }

    if (!this.agentPlaybookService.isPlaybookRuntimeEnabled()) {
      session.playbookLookupComplete = true;
      session.activePlaybook = null;
      this.updateRuntimeState(session.streamSid, {
        playbookInjected: false,
      });
      return null;
    }

    this.logger.log({
      streamSid: session.streamSid,
      message: 'voice_playbook_lookup_started',
    });

    const lookupPromise =
      this.agentPlaybookService.getActivePlaybookForRuntime();
    lookupPromise.catch(() => undefined);

    try {
      const playbook = await Promise.race([
        lookupPromise,
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), PLAYBOOK_LOOKUP_TIMEOUT_MS),
        ),
      ]);

      if (playbook === 'timeout') {
        throw new Error('Active playbook lookup timed out');
      }

      session.playbookLookupComplete = true;
      session.activePlaybook = playbook;
      session.playbookLoadError = undefined;

      this.updateRuntimeState(session.streamSid, {
        activePlaybookId: playbook?.id,
        activePlaybookVersion: playbook?.version,
        playbookInjected: Boolean(playbook),
        playbookLoadError: '',
      });

      if (playbook) {
        this.logger.log({
          streamSid: session.streamSid,
          playbookId: playbook.id,
          version: playbook.version,
          message: 'voice_playbook_injected',
        });
      }

      return playbook;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Active playbook load failed';
      session.playbookLookupComplete = true;
      session.activePlaybook = null;
      session.playbookLoadError = message;

      this.logger.error({
        streamSid: session.streamSid,
        err: error,
        failOpen: this.agentPlaybookService.shouldFailOpenRuntime(),
        message: 'voice_playbook_load_error',
      });
      this.updateRuntimeState(session.streamSid, {
        playbookInjected: false,
        playbookLoadError: message,
      });

      return null;
    }
  }

  private completeOpeningGreeting(session: OpenAiRealtimeSession): void {
    if (session.openingGreetingComplete || !session.openingContext) {
      return;
    }

    session.openingGreetingComplete = true;
    session.openingGreetingPending = false;
    session.pendingPcm8 = [];
    const nowMs = Date.now();
    const ignoreMs = this.getPostOpeningIgnoreMs();
    const speechGateMaxMs = this.getPostOpeningSpeechGateMaxMs();
    const completedAt = new Date();
    session.openingCompletedAt = completedAt;
    session.ignoreInboundAudioUntilMs = nowMs + ignoreMs;
    session.requireSpeechLikeUntilMs = nowMs + ignoreMs + speechGateMaxMs;
    session.acceptedCallerAudioAfterOpening = false;
    session.activeInstructionsMode = 'normal';

    this.logger.log({
      streamSid: session.streamSid,
      agentName: session.openingContext.agentName,
      ignoreInboundAudioMs: ignoreMs,
      speechGateMaxMs,
      message: 'voice_opening_done',
    });
    this.updateRuntimeState(session.streamSid, {
      activeInstructionsMode: 'normal',
      openingCompletedAt: completedAt,
      postOpeningIgnoreUntil: new Date(session.ignoreInboundAudioUntilMs),
    });

    if (session.ws.readyState === WebSocket.OPEN) {
      void this.sendSessionUpdate(session, session.model, 'conversation');
    }

    this.logger.log({
      streamSid: session.streamSid,
      message: 'Dropped queued inbound audio captured during opening',
    });
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

  private shouldIgnoreInboundAfterOpening(session: OpenAiRealtimeSession): boolean {
    return Boolean(
      session.ignoreInboundAudioUntilMs &&
        Date.now() < session.ignoreInboundAudioUntilMs,
    );
  }

  private isWithinPostOpeningSpeechGate(session: OpenAiRealtimeSession): boolean {
    return Boolean(
      session.requireSpeechLikeUntilMs &&
        Date.now() < session.requireSpeechLikeUntilMs,
    );
  }

  private isSpeechLikeForRuntime(pcm16: Buffer): {
    speechLike: boolean;
    rms: number;
    threshold: number;
  } {
    if (!this.isSpeechDetectionEnabled()) {
      return { speechLike: true, rms: 0, threshold: 0 };
    }

    const stats = analyzePcm16(pcm16);
    const rms = stats.rms / 32768;
    const threshold = this.getSpeechRmsThreshold();
    return { speechLike: rms >= threshold, rms, threshold };
  }

  private suppressInboundAudio(
    session: OpenAiRealtimeSession,
    reason: string,
    pcmBytes: number,
    details?: Record<string, unknown>,
  ): void {
    session.inboundSuppressedCount += 1;
    session.inboundSuppressedReason = reason;
    this.logger.log({
      streamSid: session.streamSid,
      reason,
      pcmBytes,
      suppressedCount: session.inboundSuppressedCount,
      message: 'voice_inbound_suppressed',
      ...details,
    });
    voiceDebugLog(this.logger, session.streamSid, 'voice_inbound_suppressed', {
      reason,
      pcmBytes,
      ...details,
    });
    this.updateRuntimeState(session.streamSid, {
      inboundSuppressedCount: session.inboundSuppressedCount,
      inboundSuppressedReason: reason,
    });
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
            max_output_tokens: OPENING_MAX_OUTPUT_TOKENS,
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

    if (this.shouldIgnoreInboundAfterOpening(session)) {
      this.suppressInboundAudio(session, 'post_opening_ignore_window', pcm8.length);
      return;
    }

    const speech = this.isSpeechLikeForRuntime(pcm8);
    const { speechLike } = speech;
    if (speechLike) {
      session.speechLikePacketCount += 1;
      this.updateRuntimeState(session.streamSid, {
        speechLikePacketCount: session.speechLikePacketCount,
      });
      this.logger.log({
        streamSid: session.streamSid,
        rms: Number(speech.rms.toFixed(5)),
        threshold: speech.threshold,
        message: 'voice_speech_detected',
      });
    }

    if (
      session.openingContext &&
      session.openingGreetingComplete &&
      !session.acceptedCallerAudioAfterOpening &&
      !speechLike &&
      this.isWithinPostOpeningSpeechGate(session)
    ) {
      session.ignoredSpeechPacketCount += 1;
      this.updateRuntimeState(session.streamSid, {
        ignoredSpeechPacketCount: session.ignoredSpeechPacketCount,
      });
      this.suppressInboundAudio(
        session,
        'post_opening_waiting_for_speech',
        pcm8.length,
        {
          rms: Number(speech.rms.toFixed(5)),
          threshold: speech.threshold,
          gateUntilMs: session.requireSpeechLikeUntilMs,
        },
      );
      return;
    }

    if (
      session.openingContext &&
      session.openingGreetingComplete &&
      !session.acceptedCallerAudioAfterOpening
    ) {
      const now = new Date();
      session.acceptedCallerAudioAfterOpening = true;
      this.logger.log({
        streamSid: session.streamSid,
        speechLike,
        rms: Number(speech.rms.toFixed(5)),
        threshold: speech.threshold,
        message: 'voice_inbound_accepted',
      });
      this.updateRuntimeState(session.streamSid, {
        hasReceivedCallerAudio: true,
        lastCallerAudioAt: now,
        ...(speechLike ? { lastSpeechLikeAudioAt: now } : {}),
      });
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

    voiceDebugLog(this.logger, session.streamSid, 'openai_handle_audio', {
      bytes: pcm8.length,
      appendCount: session.inputAppendCount,
      rms: Number(speech.rms.toFixed(5)),
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

  private clearHangupTimer(session: OpenAiRealtimeSession): void {
    if (session.hangupTimer) {
      clearTimeout(session.hangupTimer);
      session.hangupTimer = undefined;
      this.logger.log({
        streamSid: session.streamSid,
        message: 'voice_call_end_close_cancelled',
      });
    }
  }

  private clearCallEndMaxWaitTimer(session: OpenAiRealtimeSession): void {
    if (session.callEndMaxWaitTimer) {
      clearTimeout(session.callEndMaxWaitTimer);
      session.callEndMaxWaitTimer = undefined;
    }
  }

  private executeCallEndClose(
    session: OpenAiRealtimeSession,
    reason = 'ai_feedback_completion',
  ): void {
    try {
      const closeAt = new Date();
      session.callEndCloseAt = closeAt;
      this.logger.log({
        streamSid: session.streamSid,
        outboundBufferedBytes: session.outboundMulawBuffer.length,
        message: 'voice_call_end_close_executed',
      });
      this.updateRuntimeState(session.streamSid, {
        callEndCloseAt: closeAt,
        outboundBufferedBytes: session.outboundMulawBuffer.length,
      });
      this.audioGateway.closeStream(session.streamSid, reason);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to close Smartflo stream';
      session.callEndCloseError = message;
      this.logger.error({
        streamSid: session.streamSid,
        err: error,
        message: 'voice_call_end_close_error',
      });
      this.updateRuntimeState(session.streamSid, {
        callEndCloseError: message,
      });
    }
  }

  private scheduleCallEndMaxWait(session: OpenAiRealtimeSession): void {
    if (!this.isAutoEndCallEnabled() || session.callEndMaxWaitTimer) {
      return;
    }

    const maxWaitMs = this.getAutoEndCallMaxWaitMs();
    const scheduledAt = new Date();
    this.logger.log({
      streamSid: session.streamSid,
      maxWaitMs,
      message: 'voice_call_end_close_scheduled',
    });
    this.updateRuntimeState(session.streamSid, {
      callEndScheduledAt: scheduledAt,
    });
    session.callEndMaxWaitTimer = setTimeout(() => {
      session.callEndMaxWaitTimer = undefined;
      if (session.closing || session.hangupTimer) {
        return;
      }
      this.flushOutboundPcmRemainder(session);
      this.flushRemainingOutbound(session);
      this.executeCallEndClose(session, 'ai_feedback_completion_max_wait');
    }, maxWaitMs);
  }

  private scheduleHangupAfterCompletion(session: OpenAiRealtimeSession): void {
    if (!this.isAutoEndCallEnabled()) {
      return;
    }
    if (session.closing || session.hangupTimer) {
      return;
    }

    const delayMs = this.getAutoEndCallDelayMs();
    const scheduledAt = new Date();
    session.callEndScheduledAt = scheduledAt;
    this.logger.log({
      streamSid: session.streamSid,
      delayMs,
      outboundBufferedBytes: session.outboundMulawBuffer.length,
      message: 'voice_call_end_close_scheduled',
    });
    this.updateRuntimeState(session.streamSid, {
      callEndScheduledAt: scheduledAt,
      outboundBufferedBytes: session.outboundMulawBuffer.length,
    });
    this.clearCallEndMaxWaitTimer(session);

    session.hangupTimer = setTimeout(() => {
      session.hangupTimer = undefined;
      if (session.closing) {
        return;
      }

      this.executeCallEndClose(session);
    }, delayMs);
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
    this.logger.log({
      streamSid: session.streamSid,
      reason,
      message: 'voice_response_pending_reset',
    });
    this.updateRuntimeState(session.streamSid, {
      responsePending: false,
      isAwaitingOpenAiResponse: false,
      isAiSpeaking: false,
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

    if (
      type === 'conversation.item.input_audio_transcription.delta' ||
      type.includes('input_audio_transcription.delta')
    ) {
      const delta = extractTranscriptDelta(event);
      if (delta) {
        this.voiceTranscriptService.handleRealtimeDelta({
          streamSid,
          callId: this.resolveCallId(streamSid),
          speaker: 'customer',
          delta,
          itemId: extractEventItemId(event),
        });
      }
      return;
    }

    if (
      type === 'conversation.item.input_audio_transcription.completed' ||
      type.includes('input_audio_transcription.completed')
    ) {
      const text = extractTranscriptText(event);
      if (text) {
        void this.voiceTranscriptService
          .handleRealtimeCompleted({
            streamSid,
            callId: this.resolveCallId(streamSid),
            speaker: 'customer',
            text,
            itemId: extractEventItemId(event),
          })
          .catch((error) => {
            this.logger.warn({
              streamSid,
              message: 'transcript_error',
              err: error instanceof Error ? error.message : String(error),
            });
          });
      }
      return;
    }

    if (
      type === 'response.output_audio_transcript.delta' ||
      type.includes('output_audio_transcript.delta')
    ) {
      const delta = extractTranscriptDelta(event);
      if (delta) {
        session.assistantTranscriptBuffer += delta;
        this.voiceTranscriptService.handleRealtimeDelta({
          streamSid,
          callId: this.resolveCallId(streamSid),
          speaker: 'assistant',
          delta,
          itemId: session.assistantTranscriptItemId,
        });
      }
      return;
    }

    if (
      type === 'response.output_audio_transcript.done' ||
      type.includes('output_audio_transcript.done')
    ) {
      const text =
        extractTranscriptText(event) ?? session.assistantTranscriptBuffer.trim();
      if (text) {
        session.lastAssistantTranscript = text;
        void this.voiceTranscriptService
          .handleRealtimeCompleted({
            streamSid,
            callId: this.resolveCallId(streamSid),
            speaker: 'assistant',
            text,
            itemId: session.assistantTranscriptItemId,
          })
          .catch((error) => {
            this.logger.warn({
              streamSid,
              message: 'transcript_error',
              err: error instanceof Error ? error.message : String(error),
            });
          });
        if (shouldEndCallAfterAssistantText(text)) {
          session.callEndDetected = true;
          session.callEndReason = 'assistant_feedback_completion';
          this.logger.log({
            streamSid,
            text,
            message: 'voice_call_end_detected',
          });
          this.updateRuntimeState(streamSid, {
            callEndDetected: true,
            callEndReason: session.callEndReason,
          });
          this.scheduleCallEndMaxWait(session);
          if (!session.responseInProgress && session.responseComplete) {
            this.scheduleHangupAfterCompletion(session);
          }
        }
      }
      session.assistantTranscriptBuffer = '';
      session.assistantTranscriptItemId = undefined;
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
      session.assistantTranscriptBuffer = '';
      session.assistantTranscriptItemId = extractEventItemId(event);

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

      this.logger.log({
        streamSid,
        message: 'voice_ai_speaking_started',
      });
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
      const now = new Date();
      this.flushOutboundPcmRemainder(session);
      this.flushRemainingOutbound(session);
      this.logger.log({
        streamSid,
        totalOutputMulawSent: session.totalOutputMulawSent,
        outboundMediaCount: session.outboundMediaCount,
        message: 'voice_ai_speaking_stopped',
      });
      this.updateRuntimeState(streamSid, {
        isAiSpeaking: false,
        lastOpenAiAudioDoneAt: now,
        outboundBufferedBytes: session.outboundMulawBuffer.length,
        outboundFinalFlushAt: now,
      });
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
        outboundBufferedBytes: session.outboundMulawBuffer.length,
      });
      if (
        session.lastAssistantTranscript &&
        shouldEndCallAfterAssistantText(session.lastAssistantTranscript)
      ) {
        this.scheduleHangupAfterCompletion(session);
      }
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

  private resolveCallId(streamSid: string): string | undefined {
    return this.voiceSessionService.getByStreamSid(streamSid)?.callId;
  }

  private updateRuntimeState(
    streamSid: string,
    update: {
      runtimeProvider?: string;
      runtimeStatus?: VoiceRuntimeStatus;
      runtimeConnectedAt?: Date;
      runtimeLastEventAt?: Date;
      runtimeError?: string;
      activePlaybookId?: string;
      activePlaybookVersion?: number;
      playbookInjected?: boolean;
      playbookLoadError?: string;
      activeInstructionsMode?: 'opening' | 'normal';
      openingCompletedAt?: Date;
      inboundSuppressedCount?: number;
      inboundSuppressedReason?: string;
      postOpeningIgnoreUntil?: Date;
      speechLikePacketCount?: number;
      ignoredSpeechPacketCount?: number;
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
      lastOpenAiAudioDoneAt?: Date;
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
      outboundBufferedBytes?: number;
      outboundFinalFlushAt?: Date;
      manualFallbackCommitCount?: number;
      callEndDetected?: boolean;
      callEndReason?: string;
      callEndScheduledAt?: Date;
      callEndCloseAt?: Date;
      callEndCloseError?: string;
      incrementOpenAiEvent?: string;
    },
  ): void {
    this.voiceSessionService.updateRuntimeState(streamSid, update);
  }
}
