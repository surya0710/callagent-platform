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
  VoiceRuntimePrewarmContext,
  VoiceRuntimeSessionContext,
  VoiceRuntimeStatus,
} from './voice-runtime.provider';
import { VoiceOpeningContext, OpeningState } from '../voice-opening.types';
import {
  buildDefaultRealtimeInstructions,
  buildOpeningResponseInstructions,
  buildOpeningSessionInstructions,
  buildPostOpeningSessionInstructions,
  buildExampleOpeningMessage,
  getOpeningSkipReason,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  isOpeningInboundSuppressedState,
  OPENING_MAX_OUTPUT_TOKENS,
} from '../voice-opening.util';
import { VoiceOpeningConfigService } from '../voice-opening-config.service';
import { VoiceSocketRegistry } from '../voice-socket.registry';
import {
  DEFAULT_REALTIME_VOICE,
  parseVoiceAccent,
} from '../voice-accent.util';
import { VoiceTranscriptConfigService } from '../transcript/voice-transcript-config.service';
import { buildRealtimeTranscriptionPrompt } from '../transcript/voice-transcript-prompt.util';
import { VoiceTranscriptService } from '../transcript/voice-transcript.service';
import { buildVoiceRuntimeInstructions } from '../voice-runtime-instructions.util';
import { CallContext } from '../voice-call-context.types';
import { buildCallContextInstructions } from '../voice-call-context.util';
import {
  CallTimingDiagnosticsService,
  CallTimingEvent,
} from '../call-timing-diagnostics.service';
import { normalizeVoicePhoneNumber } from '../voice-phone.util';
import {
  isLikelyAssistantEcho,
  isValidCustomerTranscript,
  ResponseCreateSource,
  shouldAllowResponseCreate,
  shouldForwardInboundWhileAwaiting,
} from './voice-turn-taking.util';
import {
  CustomerLanguage,
  assessCustomerUtteranceLanguage,
  createInitialLanguageLockState,
  lockStateToCustomerLanguage,
  LanguageLockSessionState,
  resolveResponseLanguageFromLock,
  updateLanguageLock,
} from '../voice-language.util';
import {
  buildTurnResponseInstructions,
  mulawBytesToPlaybackMs,
  resolveInterruptedAssistantText,
  shouldCancelResponseOnInterrupt,
  shouldIgnoreCustomerInterrupt,
  shouldSkipAssistantTranscriptDone,
} from '../voice-interruption.util';

const SMARTFLO_SAMPLE_RATE = 8000;
const OPENAI_SAMPLE_RATE = OPENAI_REALTIME_SAMPLE_RATE;
const MULAW_SILENCE_BYTE = 0xff;
const INPUT_COMMIT_DELAY_MS = 600;
const MANUAL_FALLBACK_SILENCE_MS = 800;
const RESPONSE_WAIT_MS = 15000;
const SESSION_INSTRUCTION_READY_FALLBACK_MS = 750;
const OPENING_READINESS_RETRY_MS = 300;
const OPENING_READINESS_MAX_RETRIES = 40;
const WS_OPEN_TIMEOUT_MS = 8000;
const PLAYBOOK_LOOKUP_TIMEOUT_MS = 750;
const DEFAULT_POST_OPENING_SPEECH_GATE_MAX_MS = 300;
const DEFAULT_OPENING_AVAILABILITY_IGNORE_MS = 800;
const DEFAULT_OPENING_AVAILABILITY_MIN_SPEECH_MS = 80;
const DEFAULT_OPENING_AVAILABILITY_MIN_PACKETS = 2;
const DEFAULT_SPEECH_RMS_THRESHOLD = 0.01;
const DEFAULT_SPEECH_MIN_PACKETS = 2;
const DEFAULT_SPEECH_MIN_DURATION_MS = 80;
const DEFAULT_RECENT_SPEECH_MAX_AGE_MS = 2500;
const DEFAULT_AI_COMPLETION_HANGUP_DELAY_MS = 1500;
const DEFAULT_AI_COMPLETION_HANGUP_MAX_WAIT_MS = 6000;
const PREWARM_SESSION_TTL_MS = 10 * 60 * 1000;

const LIVE_OUTBOUND_PCM_OPTIONS = {
  autoNormalize: false,
  gain: 1,
} as const;

interface OpenAiRealtimeSession {
  streamSid: string;
  callSid?: string;
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
  currentResponseMulawSent: number;
  interruptedAssistantItemId?: string;
  truncateSentForItemId?: string;
  interruptedTranscriptCommitted: boolean;
  lastCloseCode?: number;
  lastCloseReason?: string;
  useServerVad: boolean;
  model: string;
  aiSpeakFirstEnabled: boolean;
  authorized: boolean;
  smartfloStartReceived: boolean;
  openingState: OpeningState;
  openAiSessionCreated: boolean;
  openAiSessionUpdated: boolean;
  openingContext?: VoiceOpeningContext;
  callContext?: CallContext;
  activePlaybook?: RuntimeAgentPlaybook | null;
  playbookLookupComplete: boolean;
  playbookLoadError?: string;
  ignoreInboundAudioUntilMs?: number;
  requireSpeechLikeUntilMs?: number;
  acceptedCallerAudioAfterOpening: boolean;
  inboundSuppressedCount: number;
  inboundSuppressedReason?: string;
  speechLikePacketCount: number;
  silencePacketCount: number;
  ignoredNoisePacketCount: number;
  ignoredSpeechPacketCount: number;
  pendingSpeechPcm8: Buffer[];
  pendingSpeechDurationMs: number;
  validCustomerSpeechSinceLastResponse: boolean;
  customerAudioAppendedSinceLastResponse: boolean;
  firstCustomerSpeechAt?: Date;
  lastRealSpeechAt?: Date;
  firstResponseCreateAt?: Date;
  startupDelayLogged: boolean;
  autoReplyBlockedCount: number;
  responseBlockedReason?: string;
  detectedCustomerLanguage?: CustomerLanguage;
  lastCustomerLanguage?: CustomerLanguage;
  preferredLanguage: CustomerLanguage;
  responseLanguage?: CustomerLanguage;
  languageLock: LanguageLockSessionState;
  languageMatchMode: 'conservative_language_lock';
  currentResponseId?: string;
  interruptedResponseId?: string;
  cancelSentForResponseId?: string;
  lastCustomerInterruptAt?: Date;
  wasInterruptedResponse: boolean;
  aiSpeakingStartedAt?: Date;
  lastAssistantText?: string;
  activeInstructionsMode?: 'opening' | 'normal';
  callEndDetected: boolean;
  callEndReason?: string;
  callEndScheduledAt?: Date;
  callEndCloseAt?: Date;
  callEndCloseError?: string;
  openingGreetingRequested: boolean;
  openingGreetingPending: boolean;
  openingGreetingComplete: boolean;
  openingIsCurrentResponse: boolean;
  openingTimeoutTimer?: NodeJS.Timeout;
  openingDelayTimer?: NodeJS.Timeout;
  openingDelayPending?: boolean;
  openingReadinessRetryTimer?: NodeJS.Timeout;
  openingReadinessRetryCount?: number;
  sessionInstructionReadyFallbackTimer?: NodeJS.Timeout;
  sessionUpdateSent?: boolean;
  telephonyStartAt?: Date;
  sessionReadyAt?: Date;
  openingSuppressedInboundPackets: number;
  openingAudioStartedAt?: Date;
  openingAudioDoneAt?: Date;
  normalModeActivatedAt?: Date;
  openingAvailabilityResponseHandled: boolean;
  openingCompletedAt?: Date;
  assistantTranscriptBuffer: string;
  lastAssistantTranscript?: string;
  assistantTranscriptItemId?: string;
  awaitingCustomerInput: boolean;
  customerTurnConfirmed: boolean;
  allowNextServerVadResponse: boolean;
  bargeInConfirmed: boolean;
  manualFallbackUsedSinceLastResponse: boolean;
  pendingAuthorizedResponseSource?: ResponseCreateSource;
  lastCustomerSpeechAt?: Date;
  lastAssistantResponseDoneAt?: Date;
}

export type CustomerCallEndIntent =
  | 'explicit_hangup'
  | 'negative_availability'
  | 'not_interested'
  | 'wrong_number'
  | 'do_not_call'
  | 'conversation_complete'
  | null;

function normalizeTranscriptForIntent(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectCustomerCallEndIntent(
  text: string,
  options?: { awaitingOpeningAvailabilityResponse?: boolean },
): CustomerCallEndIntent {
  const normalized = normalizeTranscriptForIntent(text);
  if (!normalized) {
    return null;
  }

  const doNotCall =
    /\b(stop\s+calling|don'?t\s+call|do\s+not\s+call|remove\s+(my\s+)?(number|contact)|delete\s+(my\s+)?number|take\s+me\s+off\s+(the\s+)?list)\b/.test(
      normalized,
    ) ||
    /(कॉल\s*मत|फोन\s*मत|फ़ोन\s*मत|नंबर\s*(हटा|डिलीट)|दोबारा\s*(कॉल|फोन|फ़ोन)\s*मत)/.test(
      normalized,
    );
  if (doNotCall) {
    return 'do_not_call';
  }

  const explicitHangup =
    /\b(cut|disconnect|end|drop|close)\s+(the\s+)?(call|phone|line)\b/.test(
      normalized,
    ) ||
    /\b(hang\s*up)\b/.test(normalized) ||
    /\bcall\s+(cut|kaat|kaat do)\b/.test(normalized) ||
    /\b(kaat|kaat)\s+do\b/.test(normalized) ||
    /(कॉल|फोन|फ़ोन|call)\s*(काट|बंद|डिस्कनेक्ट)/.test(normalized) ||
    /(काट\s*दो|बंद\s*करो|डिस्कनेक्ट\s*करो)/.test(normalized);
  if (explicitHangup) {
    return 'explicit_hangup';
  }

  const wrongNumber =
    /\b(wrong\s+number|wrong\s+person|not\s+my\s+number|you\s+have\s+the\s+wrong\s+number|this\s+isn'?t\s+(me|my\s+number))\b/.test(
      normalized,
    ) ||
    /(गलत\s*(नंबर|व्यक्ति)|मेरा\s*नंबर\s*नहीं|मेरे\s*लिए\s*नहीं)/.test(
      normalized,
    );
  if (wrongNumber) {
    return 'wrong_number';
  }

  const notInterested =
    /\b(not\s+interested|no\s+interest|not\s+required|no\s+requirement|don'?t\s+need|do\s+not\s+need|i\s+am\s+not\s+looking|not\s+looking|no\s+thanks|no\s+thank\s+you)\b/.test(
      normalized,
    ) ||
    /(रुचि\s*नहीं|इंटरेस्ट\s*नहीं|नहीं\s*चाहिए|ज़रूरत\s*नहीं|जरूरत\s*नहीं)/.test(
      normalized,
    );
  if (notInterested) {
    return 'not_interested';
  }

  const negativeBusy =
    /\bbusy\b/.test(normalized) && !/\bnot\s+busy\b/.test(normalized);
  const negativeAvailabilityPhrase =
    negativeBusy ||
    /\b(not\s+(a\s+)?good\s+time|bad\s+time|not\s+now|call\s+(me\s+)?later|talk\s+later|in\s+a\s+meeting|driving|can'?t\s+(talk|speak)|cannot\s+(talk|speak)|unable\s+to\s+(talk|speak))\b/.test(
      normalized,
    ) ||
    /(अभी\s*नहीं|बाद\s*में|व्यस्त|बिजी|मीटिंग|ड्राइव|फुर्सत\s*नहीं|बात\s*नहीं\s*कर)/.test(
      normalized,
    ) ||
    /(abhi\s+nahi|baad\s+mein|baad\s+me|busy\s+hu|busy\s+hoon|call\s+kar\s+lena|call\s+kar\s+lunga)/.test(
      normalized,
    );
  const affirmativeAvailability =
    /\b(yes|yeah|yep|sure|ok|okay|go\s+ahead|available|free|not\s+busy|can\s+(talk|speak))\b/.test(
      normalized,
    ) || /(हाँ|हा|जी|ठीक|बोलिए|फ्री|बात\s*कर\s*सक)/.test(normalized);
  if (affirmativeAvailability && !negativeAvailabilityPhrase) {
    return null;
  }

  if (negativeAvailabilityPhrase) {
    return 'negative_availability';
  }

  if (
    options?.awaitingOpeningAvailabilityResponse &&
    /^(no|nope|nah|nahi|nahin|nhi|नहीं|ना|न)$/.test(normalized)
  ) {
    return 'negative_availability';
  }

  const conversationComplete =
    /\b(ok\s+bye|okay\s+bye|bye|goodbye|thank\s+you\s+bye|thanks\s+bye|that'?s\s+all|nothing\s+else)\b/.test(
      normalized,
    ) || /(ठीक\s*है\s*बाय|बाय|अलविदा|बस\s*इतना|धन्यवाद)/.test(normalized);
  if (conversationComplete) {
    return 'conversation_complete';
  }

  return null;
}

function callEndReasonForIntent(
  intent: Exclude<CustomerCallEndIntent, null>,
): string {
  switch (intent) {
    case 'explicit_hangup':
      return 'customer_requested_hangup';
    case 'negative_availability':
      return 'customer_unavailable_or_requested_callback';
    case 'not_interested':
      return 'customer_not_interested';
    case 'wrong_number':
      return 'customer_wrong_number';
    case 'do_not_call':
      return 'customer_do_not_call';
    case 'conversation_complete':
      return 'customer_conversation_complete';
  }
}

function buildCallEndAcknowledgementInstructions(
  intent: Exclude<CustomerCallEndIntent, null>,
  responseLanguage: CustomerLanguage,
): string {
  const languageRule =
    responseLanguage === 'hindi'
      ? 'Reply in Hindi.'
      : responseLanguage === 'hinglish'
        ? 'Reply in Hinglish.'
        : 'Reply in English.';
  const intentInstruction =
    intent === 'negative_availability'
      ? 'Acknowledge that this is not a good time and say you will call back later.'
      : intent === 'not_interested'
        ? 'Acknowledge politely and say you will not continue.'
        : intent === 'wrong_number'
          ? 'Apologize briefly for the wrong number.'
          : intent === 'do_not_call'
            ? 'Acknowledge the do-not-call request politely.'
            : intent === 'conversation_complete'
              ? 'Close the conversation politely.'
              : 'Acknowledge and end the call politely.';

  return [
    'The customer has expressed intent to end this call.',
    languageRule,
    intentInstruction,
    'Use one short sentence only.',
    'Do not ask another question.',
    'Do not pitch, continue discovery, or keep the conversation going.',
    'After this sentence, stop speaking.',
  ].join(' ');
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

function extractResponseId(event: Record<string, unknown>): string | undefined {
  const response = asRecord(event.response);
  if (typeof response?.id === 'string') {
    return response.id;
  }
  if (typeof event.id === 'string') {
    return event.id;
  }
  return undefined;
}

function extractAssistantItemIdFromResponseCreated(
  event: Record<string, unknown>,
): string | undefined {
  const fromEvent = extractEventItemId(event);
  if (fromEvent) {
    return fromEvent;
  }

  const response = asRecord(event.response);
  const output = response?.output;
  if (!Array.isArray(output)) {
    return undefined;
  }

  for (const entry of output) {
    const item = asRecord(entry);
    if (typeof item?.id === 'string' && item.role === 'assistant') {
      return item.id;
    }
  }

  return undefined;
}

function resolveSessionResponseLanguage(session: OpenAiRealtimeSession): CustomerLanguage {
  return resolveResponseLanguageFromLock(session.languageLock.lockedLanguage);
}

@Injectable()
export class OpenAIRealtimeProvider implements VoiceRuntimeProvider {
  readonly name = 'openai-realtime';
  private readonly logger = new Logger(OpenAIRealtimeProvider.name);
  private readonly sessions = new Map<string, OpenAiRealtimeSession>();
  private readonly prewarmByCallSid = new Map<string, string>();
  private readonly prewarmByPhone = new Map<string, string>();
  private readonly prewarmCleanupTimers = new Map<string, NodeJS.Timeout>();
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
    private readonly voiceOpeningConfigService: VoiceOpeningConfigService,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
    private readonly callTiming: CallTimingDiagnosticsService,
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

  private readOptionalInt(name: string, min = 0): number | undefined {
    const raw = this.configService.get<string>(name);
    if (raw === undefined) {
      return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? Math.max(parsed, min) : undefined;
  }

  private readFloat(name: string, fallback: number, min = 0): number {
    const raw = this.configService.get<string>(name);
    const parsed = Number.parseFloat(raw ?? '');
    return Number.isFinite(parsed) ? Math.max(parsed, min) : fallback;
  }

  private getPostOpeningIgnoreMs(): number {
    return this.voiceOpeningConfigService.getPostOpeningIgnoreMs();
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

  private getSpeechMinPackets(): number {
    return this.readInt('VOICE_SPEECH_MIN_PACKETS', DEFAULT_SPEECH_MIN_PACKETS, 1);
  }

  private getSpeechMinDurationMs(): number {
    return this.readInt(
      'VOICE_SPEECH_MIN_DURATION_MS',
      DEFAULT_SPEECH_MIN_DURATION_MS,
      1,
    );
  }

  private getRecentSpeechMaxAgeMs(): number {
    return this.readInt(
      'VOICE_RECENT_SPEECH_MAX_AGE_MS',
      DEFAULT_RECENT_SPEECH_MAX_AGE_MS,
      1,
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

    const callSid = context.callSid?.trim();
    if (context.smartfloStartReceived) {
      const prewarmStreamSid = this.resolvePrewarmStreamSid(context);
      if (
        prewarmStreamSid &&
        prewarmStreamSid !== streamSid &&
        this.sessions.has(prewarmStreamSid)
      ) {
        this.adoptPrewarmSession(prewarmStreamSid, context);
        return;
      }
    }

    if (this.sessions.has(streamSid)) {
      await this.endSession(streamSid);
    }

    await this.startOpenAiSession(context);
    const session = this.sessions.get(streamSid);
    if (session) {
      this.evaluateOpeningReadiness(session);
    }
  }

  onSocketConnected(socketSessionId: string): void {
    const streamSid =
      this.voiceSocketRegistry.getStreamSidForSocket(socketSessionId);
    if (!streamSid) {
      return;
    }

    const session = this.sessions.get(streamSid);
    if (!session?.aiSpeakFirstEnabled || session.closing) {
      return;
    }

    this.logger.log({
      streamSid,
      socketSessionId,
      message: 'voice_opening_readiness_recheck_on_socket_connect',
    });
    this.evaluateOpeningReadiness(session);
  }

  prewarmAuthorizedCall(input: VoiceRuntimePrewarmContext): void {
    if (!input.aiSpeakFirstEnabled) {
      return;
    }

    const callSid = input.callSid?.trim();
    const customerNumber = input.customerNumber
      ? normalizeVoicePhoneNumber(input.customerNumber)
      : undefined;

    if (!callSid && !customerNumber) {
      return;
    }

    const prewarmKey = callSid ?? `phone:${customerNumber}`;
    if (this.prewarmByCallSid.has(prewarmKey)) {
      return;
    }

    const prewarmStreamSid = callSid
      ? `prewarm:${callSid}`
      : `prewarm:phone:${customerNumber}`;
    this.prewarmByCallSid.set(prewarmKey, prewarmStreamSid);
    if (callSid) {
      this.prewarmByCallSid.set(callSid, prewarmStreamSid);
    }
    if (customerNumber) {
      this.prewarmByPhone.set(customerNumber, prewarmStreamSid);
      this.callTiming.linkPhone(customerNumber, `phone:${customerNumber}`);
      this.callTiming.linkStreamSid(prewarmStreamSid, `phone:${customerNumber}`);
    }
    if (callSid) {
      this.callTiming.linkCallSid(
        callSid,
        customerNumber ? `phone:${customerNumber}` : `callSid:${callSid}`,
      );
      if (!customerNumber) {
        this.callTiming.linkStreamSid(prewarmStreamSid, `callSid:${callSid}`);
      }
    }
    this.schedulePrewarmCleanup(prewarmKey, prewarmStreamSid, {
      callSid,
      customerNumber,
    });

    this.logger.log({
      callSid,
      customerNumber,
      prewarmStreamSid,
      message: 'voice_openai_prewarm_started',
    });
    this.callTiming.markByPhone(
      customerNumber,
      CallTimingEvent.OPENAI_PREWARM_STARTED,
      { callSid, prewarmStreamSid },
    );
    if (callSid) {
      this.callTiming.markByCallSid(
        callSid,
        CallTimingEvent.OPENAI_PREWARM_STARTED,
        { prewarmStreamSid },
      );
    }

    void this.startOpenAiSession({
      streamSid: prewarmStreamSid,
      callSid,
      openingContext: input.openingContext,
      callContext: input.callContext,
      aiSpeakFirstEnabled: true,
      smartfloStartReceived: false,
      authorized: true,
    });
  }

  private resolvePrewarmStreamSid(
    context: VoiceRuntimeSessionContext,
  ): string | undefined {
    const callSid = context.callSid?.trim();
    if (callSid) {
      const byCallSid = this.prewarmByCallSid.get(callSid);
      if (byCallSid && this.sessions.has(byCallSid)) {
        return byCallSid;
      }
    }

    for (const rawPhone of [context.to, context.from]) {
      const phone = rawPhone ? normalizeVoicePhoneNumber(rawPhone) : undefined;
      if (!phone) {
        continue;
      }
      const byPhone = this.prewarmByPhone.get(phone);
      if (byPhone && this.sessions.has(byPhone)) {
        this.logger.log({
          streamSid: context.streamSid,
          callSid,
          matchedPhone: phone,
          prewarmStreamSid: byPhone,
          message: 'voice_openai_prewarm_adopted_by_phone',
        });
        return byPhone;
      }
    }

    return undefined;
  }

  private schedulePrewarmCleanup(
    prewarmKey: string,
    prewarmStreamSid: string,
    keys: { callSid?: string; customerNumber?: string },
  ): void {
    const existing = this.prewarmCleanupTimers.get(prewarmKey);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.prewarmCleanupTimers.delete(prewarmKey);
      if (this.prewarmByCallSid.get(prewarmKey) !== prewarmStreamSid) {
        return;
      }
      this.prewarmByCallSid.delete(prewarmKey);
      if (keys.callSid) {
        this.prewarmByCallSid.delete(keys.callSid);
      }
      if (keys.customerNumber) {
        this.prewarmByPhone.delete(keys.customerNumber);
      }
      void this.endSession(prewarmStreamSid);
      this.logger.log({
        prewarmKey,
        prewarmStreamSid,
        message: 'voice_openai_prewarm_expired',
      });
    }, PREWARM_SESSION_TTL_MS);

    this.prewarmCleanupTimers.set(prewarmKey, timer);
  }

  private clearPrewarmCleanupTimer(prewarmKey: string): void {
    const timer = this.prewarmCleanupTimers.get(prewarmKey);
    if (timer) {
      clearTimeout(timer);
      this.prewarmCleanupTimers.delete(prewarmKey);
    }
  }

  private clearPrewarmMappings(
    prewarmStreamSid: string,
    keys: { callSid?: string; customerNumber?: string; prewarmKey?: string },
  ): void {
    if (keys.prewarmKey) {
      this.clearPrewarmCleanupTimer(keys.prewarmKey);
      if (this.prewarmByCallSid.get(keys.prewarmKey) === prewarmStreamSid) {
        this.prewarmByCallSid.delete(keys.prewarmKey);
      }
    }
    if (keys.callSid && this.prewarmByCallSid.get(keys.callSid) === prewarmStreamSid) {
      this.prewarmByCallSid.delete(keys.callSid);
    }
    if (
      keys.customerNumber &&
      this.prewarmByPhone.get(keys.customerNumber) === prewarmStreamSid
    ) {
      this.prewarmByPhone.delete(keys.customerNumber);
    }
  }

  private adoptPrewarmSession(
    prewarmStreamSid: string,
    context: VoiceRuntimeSessionContext,
  ): void {
    const session = this.sessions.get(prewarmStreamSid);
    if (!session) {
      return;
    }

    const realStreamSid = context.streamSid;
    const callSid = context.callSid?.trim();
    const customerNumber = [context.to, context.from]
      .map((value) =>
        value ? normalizeVoicePhoneNumber(value) : undefined,
      )
      .find((value): value is string => Boolean(value));

    this.clearPrewarmMappings(prewarmStreamSid, {
      callSid,
      customerNumber,
      prewarmKey: callSid ?? (customerNumber ? `phone:${customerNumber}` : undefined),
    });

    this.sessions.delete(prewarmStreamSid);
    session.streamSid = realStreamSid;
    session.callSid = callSid ?? session.callSid;
    session.smartfloStartReceived = context.smartfloStartReceived === true;
    session.telephonyStartAt = new Date();
    session.openingReadinessRetryCount = 0;
    this.clearOpeningReadinessRetry(session);
    if (context.openingContext) {
      session.openingContext = context.openingContext;
    }
    if (context.callContext) {
      session.callContext = context.callContext;
    }
    this.sessions.set(realStreamSid, session);

    if (
      session.ws.readyState === WebSocket.OPEN &&
      session.openAiSessionUpdated &&
      session.callContext
    ) {
      const phase =
        session.activeInstructionsMode === 'opening' ? 'opening' : 'conversation';
      void this.sendSessionUpdate(session, session.model, phase);
    }

    if (customerNumber) {
      this.callTiming.linkStreamSid(realStreamSid, `phone:${customerNumber}`);
    }
    if (callSid) {
      this.callTiming.linkStreamSid(realStreamSid, `callSid:${callSid}`);
    }

    const prewarmMs = session.connectedAt
      ? Date.now() - session.connectedAt.getTime()
      : undefined;

    this.logger.log({
      streamSid: realStreamSid,
      prewarmStreamSid,
      callSid,
      prewarmMs,
      openAiSessionCreated: session.openAiSessionCreated,
      openingState: session.openingState,
      message: 'voice_openai_prewarm_adopted',
    });
    this.callTiming.markByStreamSid(realStreamSid, CallTimingEvent.PREWARM_ADOPTED, {
      prewarmStreamSid,
      prewarmMs,
      callSid,
    });
    this.callTiming.markByCallSid(callSid, CallTimingEvent.PREWARM_ADOPTED, {
      streamSid: realStreamSid,
      prewarmMs,
    });

    this.updateRuntimeState(realStreamSid, {
      runtimeProvider: this.name,
      runtimeStatus: session.status,
      runtimeConnectedAt: session.connectedAt,
      runtimeError: undefined,
      isOpenAiConnected: session.ws.readyState === WebSocket.OPEN,
    });

    this.voiceSessionService.updateOpeningState(realStreamSid, {
      aiSpeakFirstEnabled: session.aiSpeakFirstEnabled,
      openingState: session.openingState,
    });

    this.evaluateOpeningReadiness(session);
  }

  private async startOpenAiSession(context: VoiceRuntimeSessionContext): Promise<void> {
    const { streamSid } = context;

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

    const aiSpeakFirstEnabled = context.aiSpeakFirstEnabled === true;
    const openingContext = aiSpeakFirstEnabled ? context.openingContext : undefined;
    const callContext = context.callContext;

    const session: OpenAiRealtimeSession = {
      streamSid,
      callSid: context.callSid?.trim(),
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
      currentResponseMulawSent: 0,
      interruptedTranscriptCommitted: false,
      useServerVad,
      model,
      aiSpeakFirstEnabled,
      authorized: context.authorized !== false,
      smartfloStartReceived: context.smartfloStartReceived === true,
      telephonyStartAt: context.smartfloStartReceived
        ? new Date()
        : undefined,
      openingState: aiSpeakFirstEnabled ? 'waiting_for_openai_ready' : 'disabled',
      openAiSessionCreated: false,
      openAiSessionUpdated: false,
      openingContext,
      callContext,
      activePlaybook: null,
      playbookLookupComplete: false,
      acceptedCallerAudioAfterOpening: false,
      inboundSuppressedCount: 0,
      speechLikePacketCount: 0,
      silencePacketCount: 0,
      ignoredNoisePacketCount: 0,
      ignoredSpeechPacketCount: 0,
      pendingSpeechPcm8: [],
      pendingSpeechDurationMs: 0,
      validCustomerSpeechSinceLastResponse: false,
      customerAudioAppendedSinceLastResponse: false,
      startupDelayLogged: false,
      autoReplyBlockedCount: 0,
      preferredLanguage: 'hinglish',
      languageLock: createInitialLanguageLockState(),
      languageMatchMode: 'conservative_language_lock',
      wasInterruptedResponse: false,
      activeInstructionsMode:
        aiSpeakFirstEnabled && openingContext ? 'opening' : 'normal',
      callEndDetected: false,
      openingGreetingRequested: false,
      openingGreetingPending: false,
      openingGreetingComplete: !aiSpeakFirstEnabled,
      openingIsCurrentResponse: false,
      openingSuppressedInboundPackets: 0,
      openingAvailabilityResponseHandled: false,
      assistantTranscriptBuffer: '',
      lastAssistantTranscript: undefined,
      awaitingCustomerInput: false,
      customerTurnConfirmed: false,
      allowNextServerVadResponse: false,
      bargeInConfirmed: false,
      manualFallbackUsedSinceLastResponse: false,
    };
    this.sessions.set(streamSid, session);

    this.voiceSessionService.updateOpeningState(streamSid, {
      aiSpeakFirstEnabled,
      openingState: session.openingState,
    });

    if (aiSpeakFirstEnabled) {
      this.logger.log({
        streamSid,
        aiSpeakFirstEnabled,
        openingState: session.openingState,
        message: 'voice_ai_speak_first_enabled',
      });
      this.logger.log({
        streamSid,
        message: 'voice_opening_waiting_for_openai_ready',
      });
    }

    ws.on('open', () => {
      session.status = 'connected';
      session.connectedAt = new Date();
      this.callTiming.markByStreamSid(
        streamSid,
        CallTimingEvent.OPENAI_WEBSOCKET_CONNECTED,
        { callSid: context.callSid },
      );
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
    });

    ws.on('message', (data) => {
      const activeSession = this.findSessionByWebSocket(ws);
      if (!activeSession) {
        this.logger.warn({
          streamSid,
          message: 'OpenAI WebSocket message after session removed',
        });
        return;
      }
      this.handleServerMessage(activeSession.streamSid, data);
    });

    ws.on('error', (error) => {
      this.logger.error({ streamSid, err: error }, 'OpenAI Realtime WebSocket error');
      session.status = 'error';
      if (
        session.aiSpeakFirstEnabled &&
        !session.openingGreetingComplete &&
        session.openingState !== 'failed'
      ) {
        this.failOpeningWithFallback(
          session,
          error instanceof Error ? error.message : 'OpenAI WebSocket error',
        );
      }
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
      this.clearOpeningTimeout(session);
      this.clearOpeningDelayTimer(session);
      this.clearOpeningReadinessRetry(session);
      this.clearSessionInstructionReadyFallback(session);
      this.clearCommitTimer(session);
      this.clearHangupTimer(session);
      this.clearCallEndMaxWaitTimer(session);
      this.clearManualFallbackSilenceTimer(session);
      this.resetResponseGuards(session, 'openai_ws_close');
      this.resolveResponseWaiters(session);

      if (
        session.aiSpeakFirstEnabled &&
        !session.openingGreetingComplete &&
        session.openingState !== 'failed' &&
        !session.closing
      ) {
        this.failOpeningWithFallback(
          session,
          `OpenAI WebSocket closed: ${code} ${reason.toString()}`,
        );
      }

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
    this.clearOpeningTimeout(session);
    this.clearOpeningDelayTimer(session);
    this.clearOpeningReadinessRetry(session);
    this.clearSessionInstructionReadyFallback(session);
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
    const baseInstructions = session.aiSpeakFirstEnabled && session.openingContext
      ? phase === 'opening'
        ? buildOpeningSessionInstructions(
            session.openingContext,
            envInstructions,
            accent,
            session.callContext,
          )
        : buildPostOpeningSessionInstructions(
            session.openingContext,
            envInstructions,
            accent,
          )
      : (envInstructions ?? resolvedDefault);
    const activePlaybook =
      phase === 'conversation' || !session.aiSpeakFirstEnabled
        ? await this.resolveActivePlaybookForSession(session)
        : null;
    const isOpeningPhase =
      phase === 'opening' && session.aiSpeakFirstEnabled;
    session.activeInstructionsMode = isOpeningPhase ? 'opening' : 'normal';
    const callContextInstructions = session.callContext
      ? buildCallContextInstructions(session.callContext, {
          openingPhase: isOpeningPhase,
        })
      : undefined;
    const instructions = buildVoiceRuntimeInstructions({
      baseInstructions,
      activePlaybook,
      callContextInstructions,
      preferredLanguage: session.preferredLanguage,
      lockedLanguage: session.languageLock.lockedLanguage,
    });

    const payload = buildGaSessionUpdate({
      voice,
      instructions,
      model,
      turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      maxResponseOutputTokens:
        phase === 'conversation' && session.aiSpeakFirstEnabled
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
      hasCallContext: Boolean(session.callContext),
      callContextInjected: Boolean(callContextInstructions),
      aiSpeakFirstEnabled: session.aiSpeakFirstEnabled,
      agentName: session.openingContext?.agentName,
      activePlaybookId: activePlaybook?.id,
      activePlaybookVersion: activePlaybook?.version,
      playbookInjected: Boolean(activePlaybook),
      activeInstructionsMode: session.activeInstructionsMode,
      message: callContextInstructions
        ? 'voice_call_context_injected'
        : 'voice_runtime_instructions_normalized',
    });
    this.updateRuntimeState(session.streamSid, {
      activeInstructionsMode: session.activeInstructionsMode,
      playbookInjected: Boolean(activePlaybook),
      activePlaybookId: activePlaybook?.id,
      activePlaybookVersion: activePlaybook?.version,
    });
    session.ws.send(JSON.stringify(payload));
    session.sessionUpdateSent = true;
    this.scheduleSessionInstructionReadyFallback(session);
  }

  private clearSessionInstructionReadyFallback(
    session: OpenAiRealtimeSession,
  ): void {
    if (session.sessionInstructionReadyFallbackTimer) {
      clearTimeout(session.sessionInstructionReadyFallbackTimer);
      session.sessionInstructionReadyFallbackTimer = undefined;
    }
  }

  private scheduleSessionInstructionReadyFallback(
    session: OpenAiRealtimeSession,
  ): void {
    if (
      session.sessionInstructionReadyFallbackTimer ||
      session.openAiSessionUpdated ||
      session.closing
    ) {
      return;
    }

    session.sessionInstructionReadyFallbackTimer = setTimeout(() => {
      session.sessionInstructionReadyFallbackTimer = undefined;
      if (!session.openAiSessionUpdated && !session.closing) {
        this.markOpenAiInstructionReady(session, 'fallback');
        this.flushPendingInputIfReady(session);
      }
    }, SESSION_INSTRUCTION_READY_FALLBACK_MS);
  }

  private markOpenAiInstructionReady(
    session: OpenAiRealtimeSession,
    reason: 'session.updated' | 'fallback',
  ): void {
    if (session.openAiSessionUpdated) {
      return;
    }

    session.openAiSessionUpdated = true;
    session.sessionReady = true;
    session.openingReadinessRetryCount = 0;
    this.clearSessionInstructionReadyFallback(session);
    this.clearOpeningReadinessRetry(session);

    if (!session.sessionReadyAt) {
      session.sessionReadyAt = new Date();
    }

    this.logger.log({
      streamSid: session.streamSid,
      reason,
      openAiSessionCreated: session.openAiSessionCreated,
      sessionUpdateSent: session.sessionUpdateSent === true,
      message: 'voice_openai_session_instruction_ready',
    });

    if (
      session.openingState === 'waiting_for_openai_ready' &&
      session.aiSpeakFirstEnabled
    ) {
      this.setOpeningState(session, 'ready_to_speak', 'voice_opening_ready');
    }

    this.evaluateOpeningReadiness(session);
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

  private isSmartfloWebSocketOpen(streamSid: string): boolean {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    return Boolean(client && client.readyState === WebSocket.OPEN);
  }

  private setOpeningState(
    session: OpenAiRealtimeSession,
    openingState: OpeningState,
    logMessage?: string,
  ): void {
    session.openingState = openingState;
    if (logMessage) {
      this.logger.log({
        streamSid: session.streamSid,
        openingState,
        message: logMessage,
      });
    }
    this.voiceSessionService.updateOpeningState(session.streamSid, {
      openingState,
    });
  }

  private clearOpeningTimeout(session: OpenAiRealtimeSession): void {
    if (session.openingTimeoutTimer) {
      clearTimeout(session.openingTimeoutTimer);
      session.openingTimeoutTimer = undefined;
    }
  }

  private clearOpeningDelayTimer(session: OpenAiRealtimeSession): void {
    if (session.openingDelayTimer) {
      clearTimeout(session.openingDelayTimer);
      session.openingDelayTimer = undefined;
    }
    session.openingDelayPending = false;
  }

  private clearOpeningReadinessRetry(session: OpenAiRealtimeSession): void {
    if (session.openingReadinessRetryTimer) {
      clearTimeout(session.openingReadinessRetryTimer);
      session.openingReadinessRetryTimer = undefined;
    }
  }

  private shouldRetryOpeningReadiness(
    session: OpenAiRealtimeSession,
    skipReason: string,
  ): boolean {
    if (!session.smartfloStartReceived) {
      return false;
    }

    return [
      'smartflo_websocket_not_open',
      'openai_session_not_created',
      'openai_session_not_updated',
      'response_pending',
    ].includes(skipReason);
  }

  private scheduleOpeningReadinessRetry(session: OpenAiRealtimeSession): void {
    if (
      session.openingReadinessRetryTimer ||
      session.openingGreetingRequested ||
      session.openingGreetingComplete ||
      session.openingDelayTimer ||
      session.closing
    ) {
      return;
    }

    const retryCount = session.openingReadinessRetryCount ?? 0;
    if (retryCount >= OPENING_READINESS_MAX_RETRIES) {
      this.logger.warn({
        streamSid: session.streamSid,
        retryCount,
        message: 'voice_opening_readiness_retry_exhausted',
      });
      return;
    }

    session.openingReadinessRetryCount = retryCount + 1;
    session.openingReadinessRetryTimer = setTimeout(() => {
      session.openingReadinessRetryTimer = undefined;
      this.evaluateOpeningReadiness(session);
    }, OPENING_READINESS_RETRY_MS);
  }

  private scheduleOpeningAfterDelay(session: OpenAiRealtimeSession): void {
    if (
      session.openingDelayTimer ||
      session.openingGreetingRequested ||
      session.openingGreetingComplete ||
      session.closing
    ) {
      return;
    }

    const delayMs = this.getOpeningDelayRemainingMs(session);
    session.openingDelayPending = true;
    session.sessionReadyAt = session.sessionReadyAt ?? new Date();

    const voiceSession = this.voiceSessionService.getByStreamSid(session.streamSid);
    this.logger.log({
      streamSid: session.streamSid,
      provider: voiceSession?.telephonyProvider,
      authorizationId: voiceSession?.authorizationId,
      sessionReadyAt: session.sessionReadyAt.toISOString(),
      telephonyStartAt: session.telephonyStartAt?.toISOString(),
      delayMs,
      targetFromCallConnectMs: this.voiceOpeningConfigService.getOpeningDelayMs(),
      message: 'voice_opening_delay_scheduled',
    });

    const triggerOpening = (): void => {
      session.openingDelayTimer = undefined;
      session.openingDelayPending = false;
      this.fireDelayedOpening(session, delayMs);
    };

    if (delayMs <= 0) {
      triggerOpening();
      return;
    }

    session.openingDelayTimer = setTimeout(triggerOpening, delayMs);
  }

  private getOpeningDelayRemainingMs(session: OpenAiRealtimeSession): number {
    const targetFromStartMs = this.voiceOpeningConfigService.getOpeningDelayMs();
    if (!session.telephonyStartAt) {
      return targetFromStartMs;
    }

    const elapsedSinceStart = Date.now() - session.telephonyStartAt.getTime();
    return Math.max(0, targetFromStartMs - elapsedSinceStart);
  }

  private fireDelayedOpening(
    session: OpenAiRealtimeSession,
    delayMs: number,
  ): void {
    if (
      session.closing ||
      session.openingGreetingRequested ||
      session.openingGreetingComplete
    ) {
      return;
    }

    if (session.responseRequested || session.responseInProgress) {
      this.logger.log({
        streamSid: session.streamSid,
        responseRequested: session.responseRequested,
        responseInProgress: session.responseInProgress,
        message: 'voice_opening_skipped_response_already_active',
      });
      return;
    }

    const openingSentAt = new Date();
    const voiceSession = this.voiceSessionService.getByStreamSid(session.streamSid);
    this.logger.log({
      streamSid: session.streamSid,
      provider: voiceSession?.telephonyProvider,
      authorizationId: voiceSession?.authorizationId,
      sessionReadyAt: session.sessionReadyAt?.toISOString(),
      openingSentAt: openingSentAt.toISOString(),
      delayMs,
      message: 'voice_opening_delayed_trigger',
    });

    this.startConversationWithGreeting(session);
  }

  private scheduleOpeningTimeout(session: OpenAiRealtimeSession): void {
    this.clearOpeningTimeout(session);
    const timeoutMs = this.voiceOpeningConfigService.getOpeningTimeoutMs();
    session.openingTimeoutTimer = setTimeout(() => {
      session.openingTimeoutTimer = undefined;
      if (
        session.closing ||
        session.openingGreetingComplete ||
        session.openingState === 'opening_done' ||
        session.openingState === 'failed'
      ) {
        return;
      }

      const message = `Opening did not complete within ${timeoutMs}ms`;
      this.logger.error({
        streamSid: session.streamSid,
        timeoutMs,
        openingState: session.openingState,
        message: 'voice_opening_failed',
        error: message,
      });
      this.failOpeningWithFallback(session, message);
    }, timeoutMs);
  }

  private failOpeningWithFallback(
    session: OpenAiRealtimeSession,
    errorMessage: string,
  ): void {
    this.clearOpeningTimeout(session);
    this.clearOpeningDelayTimer(session);
    this.clearOpeningReadinessRetry(session);
    this.clearSessionInstructionReadyFallback(session);
    session.openingGreetingPending = false;
    session.openingIsCurrentResponse = false;
    session.responseRequested = false;
    session.responseInProgress = false;
    session.pendingPcm8 = [];

    this.setOpeningState(session, 'failed', 'voice_opening_failed');
    this.voiceSessionService.updateOpeningState(session.streamSid, {
      openingError: errorMessage,
    });

    if (!this.voiceOpeningConfigService.shouldFallbackToWaitForCustomer()) {
      return;
    }

    this.logger.warn({
      streamSid: session.streamSid,
      error: errorMessage,
      message: 'Falling back to customer-speech-triggered behavior after opening failure',
    });

    this.activateNormalModeAfterOpening(session, {
      failed: true,
      openingError: errorMessage,
    });
  }

  private activateNormalModeAfterOpening(
    session: OpenAiRealtimeSession,
    options?: {
      failed?: boolean;
      openingError?: string;
      preserveQueuedInbound?: boolean;
    },
  ): void {
    if (session.openingGreetingComplete && !options?.failed) {
      return;
    }

    session.openingGreetingComplete = true;
    session.openingGreetingPending = false;
    session.openingIsCurrentResponse = false;
    if (!options?.preserveQueuedInbound) {
      session.pendingPcm8 = [];
    }
    session.responseRequested = false;
    session.responseInProgress = false;

    const nowMs = Date.now();
    const baseIgnoreMs = this.getPostOpeningIgnoreMs();
    const ignoreMs =
      session.openingContext?.askPermissionBeforePitch !== false
        ? Math.max(baseIgnoreMs, DEFAULT_OPENING_AVAILABILITY_IGNORE_MS)
        : baseIgnoreMs;
    const speechGateMaxMs = this.getPostOpeningSpeechGateMaxMs();
    const completedAt = new Date();
    session.openingCompletedAt = completedAt;
    session.ignoreInboundAudioUntilMs = nowMs + ignoreMs;
    session.requireSpeechLikeUntilMs = nowMs + ignoreMs + speechGateMaxMs;
    session.acceptedCallerAudioAfterOpening = false;
    session.activeInstructionsMode = 'normal';
    session.normalModeActivatedAt = completedAt;
    session.openingAudioDoneAt = completedAt;

    if (!options?.failed) {
      this.setOpeningState(session, 'opening_done', 'voice_opening_done');
      this.voiceSessionService.updateOpeningState(session.streamSid, {
        openingDoneAt: completedAt,
        openingAudioDoneAt: completedAt,
      });
    }

    this.resetSpeechTurnState(session);
    this.clearOpeningTimeout(session);

    this.logger.log({
      streamSid: session.streamSid,
      agentName: session.openingContext?.agentName,
      ignoreInboundAudioMs: ignoreMs,
      speechGateMaxMs,
      failed: options?.failed ?? false,
      previousInstructionsMode: session.activeInstructionsMode,
      nextInstructionsMode: 'normal',
      awaitingCustomerInput: session.awaitingCustomerInput,
      message: 'voice_normal_mode_activated',
    });

    this.updateRuntimeState(session.streamSid, {
      activeInstructionsMode: 'normal',
      openingCompletedAt: completedAt,
      postOpeningIgnoreUntil: new Date(session.ignoreInboundAudioUntilMs),
      responsePending: false,
      isAwaitingOpenAiResponse: false,
      isAiSpeaking: false,
    });

    this.voiceSessionService.updateOpeningState(session.streamSid, {
      normalModeActivatedAt: completedAt,
      postOpeningIgnoreUntil: new Date(session.ignoreInboundAudioUntilMs),
      ...(options?.openingError ? { openingError: options.openingError } : {}),
    });

    if (session.ws.readyState === WebSocket.OPEN) {
      void this.sendSessionUpdate(session, session.model, 'conversation');
    }

    this.logger.log({
      streamSid: session.streamSid,
      message: 'Dropped queued inbound audio captured during opening',
    });
  }

  private completeOpeningGreeting(session: OpenAiRealtimeSession): void {
    if (session.openingGreetingComplete || !session.aiSpeakFirstEnabled) {
      return;
    }

    this.activateNormalModeAfterOpening(session);
  }

  private flushPendingInputIfReady(session: OpenAiRealtimeSession): void {
    if (session.aiSpeakFirstEnabled && !session.openingGreetingComplete) {
      return;
    }

    this.flushPendingInput(session);
  }

  private shouldSuppressOpeningInbound(session: OpenAiRealtimeSession): boolean {
    return (
      session.aiSpeakFirstEnabled &&
      !session.openingGreetingComplete &&
      isOpeningInboundSuppressedState(session.openingState)
    );
  }

  private shouldQueueInboundUntilOpeningComplete(
    session: OpenAiRealtimeSession,
  ): boolean {
    return Boolean(
      session.aiSpeakFirstEnabled &&
        !session.openingGreetingComplete &&
        (session.openingState === 'waiting_for_openai_ready' ||
          session.openingState === 'ready_to_speak' ||
          session.openingDelayPending),
    );
  }

  private shouldIgnoreInboundAfterOpening(session: OpenAiRealtimeSession): boolean {
    return Boolean(
      session.ignoreInboundAudioUntilMs &&
        Date.now() < session.ignoreInboundAudioUntilMs,
    );
  }

  /** Count speech during post-opening echo tail without forwarding to OpenAI yet. */
  private accumulateInboundDuringPostOpeningIgnore(
    session: OpenAiRealtimeSession,
    pcm8: Buffer,
    speech: { speechLike: boolean; rms: number; threshold: number },
  ): void {
    if (speech.speechLike) {
      session.speechLikePacketCount += 1;
      session.pendingSpeechPcm8.push(pcm8);
      session.pendingSpeechDurationMs += this.estimatePcm8DurationMs(pcm8);
      this.updateRuntimeState(session.streamSid, {
        speechLikePacketCount: session.speechLikePacketCount,
      });

      const hasEnoughSpeech =
        session.speechLikePacketCount >=
          this.getSpeechMinPacketsForSession(session) &&
        session.pendingSpeechDurationMs >=
          this.getSpeechMinDurationMsForSession(session);
      if (hasEnoughSpeech && !session.validCustomerSpeechSinceLastResponse) {
        this.markRealCustomerSpeech(session, speech);
      }
    }

    session.inboundSuppressedCount += 1;
    session.inboundSuppressedReason = 'post_opening_ignore_window';
    voiceDebugLog(
      this.logger,
      session.streamSid,
      'voice_inbound_suppressed',
      {
        reason: 'post_opening_ignore_window_accumulated',
        pcmBytes: pcm8.length,
        speechLike: speech.speechLike,
        pendingSpeechDurationMs: Math.round(session.pendingSpeechDurationMs),
      },
    );
  }

  /** Forward speech accumulated during the post-opening echo tail once the window ends. */
  private tryForwardAccumulatedSpeechAfterIgnore(
    session: OpenAiRealtimeSession,
    speech: { speechLike: boolean; rms: number; threshold: number },
  ): void {
    if (session.pendingSpeechPcm8.length === 0) {
      return;
    }

    const hasEnoughSpeech =
      session.speechLikePacketCount >=
        this.getSpeechMinPacketsForSession(session) &&
      session.pendingSpeechDurationMs >=
        this.getSpeechMinDurationMsForSession(session);
    if (!hasEnoughSpeech || !session.validCustomerSpeechSinceLastResponse) {
      return;
    }

    if (session.awaitingCustomerInput && !session.customerTurnConfirmed) {
      this.confirmCustomerTurn(session, 'local_speech', {
        accumulatedDuringIgnore: true,
        speechDurationMs: Math.round(session.pendingSpeechDurationMs),
      });
    }

    const pendingSpeech = session.pendingSpeechPcm8.splice(0);
    for (const pending of pendingSpeech) {
      this.appendInputAudioChunk(session, pending, true, speech);
    }

    if (
      !session.closing &&
      !session.useServerVad &&
      !this.isAiTurnActive(session)
    ) {
      this.scheduleInputCommit(session);
    }

    this.logTurnTaking(session, 'voice_accumulated_speech_forwarded', {
      chunks: pendingSpeech.length,
      speechDurationMs: Math.round(session.pendingSpeechDurationMs),
    });
  }

  private shouldRequireLocalSpeechForCallEndIntent(
    session: OpenAiRealtimeSession,
  ): boolean {
    return this.isAwaitingOpeningAvailabilityResponse(session);
  }

  private isAwaitingOpeningAvailabilityResponse(
    session: OpenAiRealtimeSession,
  ): boolean {
    return Boolean(
      session.aiSpeakFirstEnabled &&
        session.openingContext &&
        session.openingContext.askPermissionBeforePitch !== false &&
        session.openingGreetingComplete &&
        !session.openingAvailabilityResponseHandled,
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

  private estimatePcm8DurationMs(pcm8: Buffer): number {
    return (Math.floor(pcm8.length / 2) / SMARTFLO_SAMPLE_RATE) * 1000;
  }

  private hasValidRecentSpeech(session: OpenAiRealtimeSession): boolean {
    if (!session.validCustomerSpeechSinceLastResponse || !session.lastRealSpeechAt) {
      return false;
    }
    return Date.now() - session.lastRealSpeechAt.getTime() <= this.getRecentSpeechMaxAgeMs();
  }

  private resetSpeechTurnState(session: OpenAiRealtimeSession): void {
    session.speechLikePacketCount = 0;
    session.silencePacketCount = 0;
    session.ignoredNoisePacketCount = 0;
    session.pendingSpeechPcm8 = [];
    session.pendingSpeechDurationMs = 0;
    session.validCustomerSpeechSinceLastResponse = false;
    session.customerAudioAppendedSinceLastResponse = false;
    session.lastRealSpeechAt = undefined;
    this.updateRuntimeState(session.streamSid, {
      speechLikePacketCount: 0,
      silencePacketCount: 0,
      ignoredNoisePacketCount: 0,
    });
  }

  private markRealCustomerSpeech(
    session: OpenAiRealtimeSession,
    speech: { rms: number; threshold: number },
  ): void {
    const now = new Date();
    session.validCustomerSpeechSinceLastResponse = true;
    session.lastRealSpeechAt = now;
    if (!session.firstCustomerSpeechAt) {
      session.firstCustomerSpeechAt = now;
    }

    const startupListenDelayMs =
      session.openingCompletedAt && !session.startupDelayLogged
        ? Math.max(0, now.getTime() - session.openingCompletedAt.getTime())
        : undefined;

    this.logger.log({
      streamSid: session.streamSid,
      speechLikePacketCount: session.speechLikePacketCount,
      speechDurationMs: Math.round(session.pendingSpeechDurationMs),
      rms: Number(speech.rms.toFixed(5)),
      threshold: speech.threshold,
      firstCustomerSpeechAt: session.firstCustomerSpeechAt,
      startupListenDelayMs,
      message: 'voice_speech_detected',
    });

    if (startupListenDelayMs !== undefined) {
      session.startupDelayLogged = true;
      this.logger.log({
        streamSid: session.streamSid,
        startupListenDelayMs,
        message: 'voice_startup_delay_metric',
      });
    }

    this.updateRuntimeState(session.streamSid, {
      speechLikePacketCount: session.speechLikePacketCount,
      lastSpeechLikeAudioAt: now,
      firstCustomerSpeechAt: session.firstCustomerSpeechAt,
      startupListenDelayMs,
    });
  }

  private recordNoiseIgnored(
    session: OpenAiRealtimeSession,
    pcmBytes: number,
    speech: { rms: number; threshold: number },
    reason: string,
  ): void {
    session.ignoredNoisePacketCount += 1;
    this.logger.log({
      streamSid: session.streamSid,
      reason,
      ignoredNoisePacketCount: session.ignoredNoisePacketCount,
      speechLikePacketCount: session.speechLikePacketCount,
      silencePacketCount: session.silencePacketCount,
      rms: Number(speech.rms.toFixed(5)),
      threshold: speech.threshold,
      message: 'voice_noise_ignored',
    });
    this.suppressInboundAudio(session, reason, pcmBytes, {
      rms: Number(speech.rms.toFixed(5)),
      threshold: speech.threshold,
    });
    this.updateRuntimeState(session.streamSid, {
      ignoredNoisePacketCount: session.ignoredNoisePacketCount,
      silencePacketCount: session.silencePacketCount,
    });
  }

  private blockAutoReply(
    session: OpenAiRealtimeSession,
    reason: string,
    details?: Record<string, unknown>,
  ): void {
    session.autoReplyBlockedCount += 1;
    session.responseBlockedReason = reason;
    this.clearCommitTimer(session);
    this.clearManualFallbackSilenceTimer(session);
    this.logger.warn({
      streamSid: session.streamSid,
      reason,
      autoReplyBlockedCount: session.autoReplyBlockedCount,
      speechLikePacketCount: session.speechLikePacketCount,
      silencePacketCount: session.silencePacketCount,
      ignoredNoisePacketCount: session.ignoredNoisePacketCount,
      message: 'voice_auto_reply_blocked',
      ...details,
    });
    this.updateRuntimeState(session.streamSid, {
      autoReplyBlockedCount: session.autoReplyBlockedCount,
      responseBlockedReason: reason,
    });
  }

  private isAiTurnActive(session: OpenAiRealtimeSession): boolean {
    return session.responseInProgress || session.responseRequested;
  }

  private hasLocallyValidatedCustomerSpeechSinceAssistantDone(
    session: OpenAiRealtimeSession,
  ): boolean {
    if (!session.validCustomerSpeechSinceLastResponse || !session.lastRealSpeechAt) {
      return false;
    }
    if (!session.lastAssistantResponseDoneAt) {
      return true;
    }
    return (
      session.lastRealSpeechAt.getTime() >
      session.lastAssistantResponseDoneAt.getTime()
    );
  }

  private getSpeechMinPacketsForSession(session: OpenAiRealtimeSession): number {
    if (
      this.isAwaitingOpeningAvailabilityResponse(session) &&
      !session.customerTurnConfirmed
    ) {
      return Math.max(
        this.getSpeechMinPackets(),
        DEFAULT_OPENING_AVAILABILITY_MIN_PACKETS,
      );
    }
    return this.getSpeechMinPackets();
  }

  private getSpeechMinDurationMsForSession(
    session: OpenAiRealtimeSession,
  ): number {
    if (
      this.isAwaitingOpeningAvailabilityResponse(session) &&
      !session.customerTurnConfirmed
    ) {
      return Math.max(
        this.getSpeechMinDurationMs(),
        DEFAULT_OPENING_AVAILABILITY_MIN_SPEECH_MS,
      );
    }
    return this.getSpeechMinDurationMs();
  }

  private logTurnTaking(
    session: OpenAiRealtimeSession,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    this.logger.log({
      streamSid: session.streamSid,
      awaitingCustomerInput: session.awaitingCustomerInput,
      customerTurnConfirmed: session.customerTurnConfirmed,
      responsePending: session.responseRequested || session.responseInProgress,
      aiSpeaking: session.responseInProgress,
      lastCustomerSpeechAt: session.lastCustomerSpeechAt,
      lastAssistantResponseDoneAt: session.lastAssistantResponseDoneAt,
      allowNextServerVadResponse: session.allowNextServerVadResponse,
      bargeInConfirmed: session.bargeInConfirmed,
      activeInstructionsMode: session.activeInstructionsMode,
      openingGreetingComplete: session.openingGreetingComplete,
      message,
      ...details,
    });
  }

  private setAwaitingCustomerInput(
    session: OpenAiRealtimeSession,
    awaiting: boolean,
    reason: string,
  ): void {
    if (session.awaitingCustomerInput === awaiting) {
      return;
    }

    session.awaitingCustomerInput = awaiting;
    if (awaiting) {
      session.customerTurnConfirmed = false;
      session.allowNextServerVadResponse = false;
      session.bargeInConfirmed = false;
      session.manualFallbackUsedSinceLastResponse = false;
    }

    this.logTurnTaking(session, 'voice_awaiting_customer_input_changed', {
      awaitingCustomerInput: awaiting,
      reason,
    });
    this.updateRuntimeState(session.streamSid, {
      awaitingCustomerInput: awaiting,
    });
  }

  private confirmCustomerTurn(
    session: OpenAiRealtimeSession,
    source: 'local_speech' | 'transcript' | 'speech_stopped',
    details?: Record<string, unknown>,
  ): void {
    if (session.customerTurnConfirmed && !session.awaitingCustomerInput) {
      return;
    }

    const now = new Date();
    session.customerTurnConfirmed = true;
    session.allowNextServerVadResponse = true;
    session.lastCustomerSpeechAt = now;
    this.setAwaitingCustomerInput(session, false, `customer_turn_${source}`);

    this.logTurnTaking(session, 'voice_customer_turn_confirmed', {
      source,
      ...details,
    });
    this.updateRuntimeState(session.streamSid, {
      lastCustomerSpeechAt: now,
    });
  }

  private clearOpenAiInputBuffer(
    session: OpenAiRealtimeSession,
    reason: string,
  ): void {
    if (session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      session.ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      this.logTurnTaking(session, 'voice_input_audio_buffer_cleared', { reason });
    } catch (error) {
      this.logger.warn({
        streamSid: session.streamSid,
        reason,
        err: error,
        message: 'Failed to clear OpenAI input audio buffer',
      });
    }
  }

  private logResponseCreateSkipped(
    session: OpenAiRealtimeSession,
    source: ResponseCreateSource,
    skipReason: string,
    details?: Record<string, unknown>,
  ): void {
    this.logTurnTaking(session, 'voice_response_create_skipped', {
      source,
      skipReason,
      ...details,
    });
  }

  private sendResponseCreate(
    session: OpenAiRealtimeSession,
    source: ResponseCreateSource,
    response?: Record<string, unknown>,
    options?: { forceOnEnd?: boolean; manualFallback?: boolean },
  ): boolean {
    const gate = shouldAllowResponseCreate({
      awaitingCustomerInput: session.awaitingCustomerInput,
      customerTurnConfirmed: session.customerTurnConfirmed,
      responseRequested: session.responseRequested,
      responseInProgress: session.responseInProgress,
      source,
      forceOnEnd: options?.forceOnEnd,
      manualFallback: options?.manualFallback,
      manualFallbackUsedSinceLastResponse:
        session.manualFallbackUsedSinceLastResponse,
    });

    if (!gate.allowed) {
      this.logResponseCreateSkipped(session, source, gate.skipReason ?? 'blocked', {
        forceOnEnd: options?.forceOnEnd ?? false,
        manualFallback: options?.manualFallback ?? false,
      });
      return false;
    }

    if (options?.manualFallback) {
      session.manualFallbackUsedSinceLastResponse = true;
    }

    session.responseRequested = true;
    session.responseCreateCount += 1;
    session.pendingAuthorizedResponseSource = source;
    session.bargeInConfirmed = false;

    const now = new Date();
    if (!session.firstResponseCreateAt) {
      session.firstResponseCreateAt = now;
    }

    try {
      session.ws.send(
        JSON.stringify({
          type: 'response.create',
          ...(response ? { response } : {}),
        }),
      );
    } catch (error) {
      session.responseRequested = false;
      session.pendingAuthorizedResponseSource = undefined;
      session.responseCreateCount = Math.max(0, session.responseCreateCount - 1);
      throw error;
    }

    this.logTurnTaking(session, 'voice_response_create_called', {
      source,
      responseCreateCount: session.responseCreateCount,
      forceOnEnd: options?.forceOnEnd ?? false,
      manualFallback: options?.manualFallback ?? false,
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: now,
      responseCreateCount: session.responseCreateCount,
      lastResponseCreateAt: now,
      firstResponseCreateAt: session.firstResponseCreateAt,
      responsePending: true,
      isAwaitingOpenAiResponse: true,
      incrementOpenAiEvent: 'response.create',
    });
    return true;
  }

  private tryCancelUnauthorizedResponse(
    session: OpenAiRealtimeSession,
    reason: string,
  ): void {
    if (session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      session.ws.send(JSON.stringify({ type: 'response.cancel' }));
      this.logTurnTaking(session, 'voice_unauthorized_response_cancelled', {
        reason,
      });
    } catch (error) {
      this.logger.warn({
        streamSid: session.streamSid,
        reason,
        err: error,
        message: 'Failed to cancel unauthorized OpenAI response',
      });
    }
  }

  private tryTruncateInterruptedAssistantItem(
    session: OpenAiRealtimeSession,
    reason: string,
  ): void {
    const itemId = session.assistantTranscriptItemId;
    if (!itemId || session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (session.truncateSentForItemId === itemId) {
      return;
    }

    const audioEndMs = mulawBytesToPlaybackMs(session.currentResponseMulawSent);
    const partialText = resolveInterruptedAssistantText({
      assistantTranscriptBuffer: session.assistantTranscriptBuffer,
      lastAssistantText: session.lastAssistantText,
    });

    session.truncateSentForItemId = itemId;
    session.interruptedAssistantItemId = itemId;

    if (partialText) {
      session.lastAssistantText = partialText;
      session.lastAssistantTranscript = partialText;
    }

    try {
      session.ws.send(
        JSON.stringify({
          type: 'conversation.item.truncate',
          item_id: itemId,
          content_index: 0,
          audio_end_ms: audioEndMs,
        }),
      );
      this.logger.log({
        streamSid: session.streamSid,
        itemId,
        audioEndMs,
        currentResponseMulawSent: session.currentResponseMulawSent,
        partialTextLength: partialText?.length ?? 0,
        reason,
        message: 'conversation_item_truncate_sent',
      });
      this.logTurnTaking(session, 'voice_conversation_item_truncate_sent', {
        itemId,
        audioEndMs,
        reason,
      });
    } catch (error) {
      this.logger.warn({
        streamSid: session.streamSid,
        itemId,
        reason,
        err: error,
        message: 'Failed to truncate interrupted assistant conversation item',
      });
    }
  }

  private commitInterruptedAssistantTranscript(
    session: OpenAiRealtimeSession,
  ): void {
    if (session.interruptedTranscriptCommitted) {
      return;
    }

    const text = resolveInterruptedAssistantText({
      assistantTranscriptBuffer: session.assistantTranscriptBuffer,
      lastAssistantText: session.lastAssistantText,
    });
    if (!text) {
      return;
    }

    session.interruptedTranscriptCommitted = true;

    const streamSid = session.streamSid;
    const endedAtMs = this.resolveTranscriptOffsetMs(session);
    const startedAtMs = session.aiSpeakingStartedAt
      ? this.resolveTranscriptOffsetMs(session, session.aiSpeakingStartedAt)
      : Math.max(0, endedAtMs - 2000);

    void this.voiceTranscriptService
      .handleRealtimeCompleted({
        streamSid,
        callId: this.resolveCallId(streamSid),
        speaker: 'assistant',
        text,
        itemId: session.interruptedAssistantItemId,
        startedAtMs,
        endedAtMs,
      })
      .catch((error) => {
        this.logger.warn({
          streamSid,
          message: 'transcript_error',
          err: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private tryCancelInterruptedResponse(
    session: OpenAiRealtimeSession,
    reason: string,
  ): void {
    const cancelGate = shouldCancelResponseOnInterrupt({
      currentResponseId: session.currentResponseId,
      cancelSentForResponseId: session.cancelSentForResponseId,
      responseInProgress: session.responseInProgress,
    });

    if (!cancelGate.shouldCancel) {
      this.logger.log({
        streamSid: session.streamSid,
        currentResponseId: session.currentResponseId,
        cancelSentForResponseId: session.cancelSentForResponseId,
        skipReason: cancelGate.skipReason,
        message: 'response_cancel_skipped',
      });
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const interruptedResponseId = session.currentResponseId;
    session.interruptedResponseId = interruptedResponseId;
    if (interruptedResponseId) {
      session.cancelSentForResponseId = interruptedResponseId;
    }
    session.wasInterruptedResponse = true;
    session.lastCustomerInterruptAt = new Date();
    session.outboundMulawBuffer = Buffer.alloc(0);

    try {
      session.ws.send(JSON.stringify({ type: 'response.cancel' }));
      this.logger.log({
        streamSid: session.streamSid,
        interruptedResponseId,
        reason,
        message: 'response_cancel_sent',
      });
      this.logTurnTaking(session, 'interrupted_response_id', {
        interruptedResponseId,
        reason,
      });
    } catch (error) {
      this.logger.warn({
        streamSid: session.streamSid,
        reason,
        err: error,
        message: 'Failed to cancel interrupted OpenAI response',
      });
    }
  }

  private applyCustomerLanguageDetection(
    session: OpenAiRealtimeSession,
    text: string,
  ): void {
    const assessment = assessCustomerUtteranceLanguage(text);
    const lockResult = updateLanguageLock(session.languageLock, assessment);

    session.detectedCustomerLanguage = assessment.detection.language;
    if (assessment.detection.language !== 'unknown') {
      session.lastCustomerLanguage = assessment.detection.language;
    }

    session.preferredLanguage = lockStateToCustomerLanguage(
      lockResult.lockedLanguage,
    );
    session.responseLanguage = resolveSessionResponseLanguage(session);

    this.logger.log({
      streamSid: session.streamSid,
      detectedLanguage: lockResult.detectedLanguage,
      lockedLanguage: lockResult.lockedLanguage,
      previousLock: lockResult.previousLock,
      reason: lockResult.reason,
      hindiWordRatio: Number(lockResult.hindiWordRatio.toFixed(3)),
      utteranceSample: lockResult.utteranceSample,
      changed: lockResult.changed,
      consecutivePrimaryHindiTurns:
        session.languageLock.consecutivePrimaryHindiTurns,
      consecutivePrimaryEnglishHinglishTurns:
        session.languageLock.consecutivePrimaryEnglishHinglishTurns,
      preferredLanguage: session.preferredLanguage,
      responseLanguage: session.responseLanguage,
      message: lockResult.changed
        ? 'language_lock_changed'
        : 'language_lock_evaluated',
    });

    this.updateRuntimeState(session.streamSid, {
      detectedCustomerLanguage: assessment.detection.language,
      lastCustomerLanguage: session.lastCustomerLanguage,
      preferredLanguage: session.preferredLanguage,
      responseLanguage: session.responseLanguage,
      languageMatchMode: session.languageMatchMode,
    });
  }

  private shouldForwardInboundToOpenAi(session: OpenAiRealtimeSession): {
    forward: boolean;
    reason: string;
  } {
    return shouldForwardInboundWhileAwaiting({
      awaitingCustomerInput: session.awaitingCustomerInput,
      customerTurnConfirmed: session.customerTurnConfirmed,
      aiTurnActive: this.isAiTurnActive(session),
      bargeInConfirmed: session.bargeInConfirmed,
    });
  }

  private suppressInboundForTurnTaking(
    session: OpenAiRealtimeSession,
    pcmBytes: number,
    reason: string,
    speech?: { rms: number; threshold: number },
  ): void {
    this.suppressInboundAudio(session, reason, pcmBytes, {
      rms: speech ? Number(speech.rms.toFixed(5)) : undefined,
      threshold: speech?.threshold,
      awaitingCustomerInput: session.awaitingCustomerInput,
      customerTurnConfirmed: session.customerTurnConfirmed,
      aiTurnActive: this.isAiTurnActive(session),
    });
  }

  private suppressOpeningInboundAudio(
    session: OpenAiRealtimeSession,
    pcmBytes: number,
    reason: string,
  ): void {
    session.openingSuppressedInboundPackets += 1;
    this.suppressInboundAudio(session, reason, pcmBytes, {
      openingSuppressedInboundPackets: session.openingSuppressedInboundPackets,
    });
    this.voiceSessionService.updateOpeningState(session.streamSid, {
      openingSuppressedInboundPackets: session.openingSuppressedInboundPackets,
    });
    this.logger.log({
      streamSid: session.streamSid,
      reason,
      pcmBytes,
      openingSuppressedInboundPackets: session.openingSuppressedInboundPackets,
      message: 'voice_opening_customer_audio_suppressed',
    });
  }

  private evaluateOpeningReadiness(session: OpenAiRealtimeSession): void {
    if (!session.aiSpeakFirstEnabled) {
      this.logger.log({
        streamSid: session.streamSid,
        VOICE_AI_SPEAK_FIRST_ENABLED: false,
        reason: 'speak_first_disabled',
        message: 'opening skipped reason',
      });
      return;
    }

    if (!session.openingContext) {
      this.logger.log({
        streamSid: session.streamSid,
        VOICE_AI_SPEAK_FIRST_ENABLED: true,
        reason: 'opening_context_missing',
        message: 'opening skipped reason',
      });
      return;
    }

    if (
      session.openingState === 'waiting_for_openai_ready' &&
      session.openAiSessionUpdated
    ) {
      if (!session.sessionReadyAt) {
        session.sessionReadyAt = new Date();
      }
      this.setOpeningState(session, 'ready_to_speak', 'voice_opening_ready');
      this.logger.log({
        streamSid: session.streamSid,
        openAiSessionCreated: session.openAiSessionCreated,
        openAiSessionUpdated: session.openAiSessionUpdated,
        sessionReadyAt: session.sessionReadyAt.toISOString(),
        message: 'OpenAI session ready',
      });
    }

    const readinessInput = {
      aiSpeakFirstEnabled: session.aiSpeakFirstEnabled,
      openingState: session.openingState,
      authorized: session.authorized,
      smartfloStartReceived: session.smartfloStartReceived,
      streamSidKnown: Boolean(session.streamSid),
      smartfloWebSocketOpen: this.isSmartfloWebSocketOpen(session.streamSid),
      openAiWebSocketOpen: session.ws.readyState === WebSocket.OPEN,
      openAiSessionCreated: session.openAiSessionCreated,
      openAiSessionUpdated: session.openAiSessionUpdated,
      responsePending: session.responseRequested || session.responseInProgress,
      openingAlreadyRequested: session.openingGreetingRequested,
    };

    const skipReason = getOpeningSkipReason(readinessInput);
    if (session.smartfloStartReceived || skipReason === null) {
      this.callTiming.markByStreamSid(
        session.streamSid,
        CallTimingEvent.OPENING_READINESS_EVALUATED,
        {
          skipReason,
          openingState: session.openingState,
          openAiSessionCreated: session.openAiSessionCreated,
          smartfloStartReceived: session.smartfloStartReceived,
        },
      );
    }
    if (skipReason) {
      this.logger.log({
        streamSid: session.streamSid,
        reason: skipReason,
        openingState: session.openingState,
        smartfloStartReceived: session.smartfloStartReceived,
        smartfloWebSocketOpen: readinessInput.smartfloWebSocketOpen,
        openAiSessionCreated: session.openAiSessionCreated,
        openAiSessionUpdated: session.openAiSessionUpdated,
        message: 'opening skipped reason',
      });
      if (this.shouldRetryOpeningReadiness(session, skipReason)) {
        this.scheduleOpeningReadinessRetry(session);
      }
      return;
    }

    this.clearOpeningReadinessRetry(session);
    this.scheduleOpeningAfterDelay(session);
  }

  private tryStartOpeningGreeting(session: OpenAiRealtimeSession): void {
    this.evaluateOpeningReadiness(session);
  }

  startConversationWithGreeting(session: OpenAiRealtimeSession): void {
    if (
      !session.aiSpeakFirstEnabled ||
      !session.openingContext ||
      session.closing
    ) {
      return;
    }

    if (session.openingGreetingRequested || session.openingGreetingComplete) {
      this.logger.log({
        streamSid: session.streamSid,
        openingGreetingRequested: session.openingGreetingRequested,
        openingGreetingComplete: session.openingGreetingComplete,
        message: 'opening already sent guard',
      });
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      const message = 'OpenAI WebSocket not open for opening greeting';
      this.logger.error({
        streamSid: session.streamSid,
        message: 'voice_opening_failed',
        error: message,
      });
      this.failOpeningWithFallback(session, message);
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
    session.openingIsCurrentResponse = true;
    this.clearOpeningDelayTimer(session);

    const now = new Date();
    if (!session.firstResponseCreateAt) {
      session.firstResponseCreateAt = now;
    }

    this.setOpeningState(
      session,
      'opening_response_requested',
      'voice_opening_response_requested',
    );

    const openingGreetingText = buildExampleOpeningMessage(
      session.openingContext,
      session.callContext,
    );

    this.logger.log({
      streamSid: session.streamSid,
      openingGreetingText,
      VOICE_AI_SPEAK_FIRST_ENABLED: true,
      message: 'opening greeting text',
    });

    this.logger.log({
      streamSid: session.streamSid,
      openingContext: session.openingContext,
      message: 'voice_opening_response_requested',
    });
    voiceDebugLog(
      this.logger,
      session.streamSid,
      'voice_opening_response_requested',
      {
        agentName: session.openingContext.agentName,
        companyName: session.openingContext.companyName,
      },
      { bypassThrottle: true },
    );

    this.voiceSessionService.updateOpeningState(session.streamSid, {
      openingContext: session.openingContext,
      openingRequestedAt: now,
    });

    this.scheduleOpeningTimeout(session);

    try {
      const sent = this.sendResponseCreate(session, 'opening', {
        modalities: ['audio'],
        instructions: buildOpeningResponseInstructions(
          session.openingContext,
          session.callContext,
        ),
        max_output_tokens: OPENING_MAX_OUTPUT_TOKENS,
      });
      if (!sent) {
        throw new Error('Opening response.create blocked by turn-taking guard');
      }
      const voiceSession = this.voiceSessionService.getByStreamSid(session.streamSid);
      this.logger.log({
        streamSid: session.streamSid,
        provider: voiceSession?.telephonyProvider,
        authorizationId: voiceSession?.authorizationId,
        sessionReadyAt: session.sessionReadyAt?.toISOString(),
        openingSentAt: now.toISOString(),
        delayMs: session.sessionReadyAt
          ? now.getTime() - session.sessionReadyAt.getTime()
          : undefined,
        message: 'opening response.create sent',
      });
      this.callTiming.markByStreamSid(
        session.streamSid,
        CallTimingEvent.OPENING_RESPONSE_CREATE_SENT,
      );
      this.callTiming.markByCallSid(
        session.callSid,
        CallTimingEvent.OPENING_RESPONSE_CREATE_SENT,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to send opening greeting';
      session.openingGreetingPending = false;
      session.openingIsCurrentResponse = false;
      session.responseRequested = false;
      this.logger.error({
        streamSid: session.streamSid,
        err: error,
        message: 'voice_opening_failed',
      });
      this.failOpeningWithFallback(session, message);
      return;
    }
  }

  private appendInputAudio(session: OpenAiRealtimeSession, pcm8: Buffer): void {
    if (this.shouldQueueInboundUntilOpeningComplete(session)) {
      session.pendingPcm8.push(pcm8);
      return;
    }

    if (this.shouldSuppressOpeningInbound(session)) {
      this.suppressOpeningInboundAudio(
        session,
        pcm8.length,
        'opening_audio_playing',
      );
      return;
    }

    const speech = this.isSpeechLikeForRuntime(pcm8);

    if (this.shouldIgnoreInboundAfterOpening(session)) {
      this.accumulateInboundDuringPostOpeningIgnore(session, pcm8, speech);
      return;
    }

    this.tryForwardAccumulatedSpeechAfterIgnore(session, speech);

    const { speechLike } = speech;
    const forwardGate = this.shouldForwardInboundToOpenAi(session);

    if (speechLike) {
      session.speechLikePacketCount += 1;
      session.pendingSpeechPcm8.push(pcm8);
      session.pendingSpeechDurationMs += this.estimatePcm8DurationMs(pcm8);
      this.updateRuntimeState(session.streamSid, {
        speechLikePacketCount: session.speechLikePacketCount,
      });

      const hasEnoughSpeech =
        session.speechLikePacketCount >=
          this.getSpeechMinPacketsForSession(session) &&
        session.pendingSpeechDurationMs >=
          this.getSpeechMinDurationMsForSession(session);
      if (!hasEnoughSpeech) {
        return;
      }

      if (this.isAiTurnActive(session) && !session.bargeInConfirmed) {
        const interruptGate = shouldIgnoreCustomerInterrupt({
          aiSpeaking: session.responseInProgress,
          speechDurationMs: session.pendingSpeechDurationMs,
          speechMinDurationMs: this.getSpeechMinDurationMsForSession(session),
          rms: speech.rms,
          rmsThreshold: speech.threshold,
          aiSpeakingStartedAt: session.aiSpeakingStartedAt,
        });

        if (interruptGate.ignore) {
          this.logger.log({
            streamSid: session.streamSid,
            skipReason: interruptGate.reason,
            speechDurationMs: Math.round(session.pendingSpeechDurationMs),
            rms: Number(speech.rms.toFixed(5)),
            message: 'interrupt_ignored_reason',
          });
          return;
        }

        session.bargeInConfirmed = true;
        this.logger.log({
          streamSid: session.streamSid,
          currentResponseId: session.currentResponseId,
          speechDurationMs: Math.round(session.pendingSpeechDurationMs),
          rms: Number(speech.rms.toFixed(5)),
          message: 'customer_interrupt_detected',
        });
        this.audioGateway.sendClear(session.streamSid);
        this.tryTruncateInterruptedAssistantItem(session, 'customer_barge_in');
        this.tryCancelInterruptedResponse(session, 'customer_barge_in');
        this.logTurnTaking(session, 'voice_barge_in_detected', {
          speechDurationMs: Math.round(session.pendingSpeechDurationMs),
          rms: Number(speech.rms.toFixed(5)),
        });
        this.confirmCustomerTurn(session, 'local_speech', {
          bargeIn: true,
          speechDurationMs: Math.round(session.pendingSpeechDurationMs),
        });
      } else if (
        session.awaitingCustomerInput &&
        !session.customerTurnConfirmed
      ) {
        this.confirmCustomerTurn(session, 'local_speech', {
          speechDurationMs: Math.round(session.pendingSpeechDurationMs),
          rms: Number(speech.rms.toFixed(5)),
        });
      }

      if (!session.validCustomerSpeechSinceLastResponse) {
        this.markRealCustomerSpeech(session, speech);
      } else {
        session.lastRealSpeechAt = new Date();
      }

      if (
        session.aiSpeakFirstEnabled &&
        session.openingGreetingComplete &&
        !session.acceptedCallerAudioAfterOpening
      ) {
        const now = new Date();
        session.acceptedCallerAudioAfterOpening = true;
        this.logger.log({
          streamSid: session.streamSid,
          speechLike: true,
          rms: Number(speech.rms.toFixed(5)),
          threshold: speech.threshold,
          message: 'voice_inbound_accepted',
        });
        this.updateRuntimeState(session.streamSid, {
          hasReceivedCallerAudio: true,
          lastCallerAudioAt: now,
          lastSpeechLikeAudioAt: now,
        });
      }

      const refreshedForwardGate = this.shouldForwardInboundToOpenAi(session);
      if (!refreshedForwardGate.forward) {
        this.suppressInboundForTurnTaking(
          session,
          pcm8.length,
          refreshedForwardGate.reason,
          speech,
        );
        return;
      }

      const pendingSpeech = session.pendingSpeechPcm8.splice(0);
      for (const pending of pendingSpeech) {
        this.appendInputAudioChunk(session, pending, true, speech);
      }

      if (!session.closing && !session.useServerVad && !this.isAiTurnActive(session)) {
        this.scheduleInputCommit(session);
      }
      return;
    }

    session.silencePacketCount += 1;
    this.updateRuntimeState(session.streamSid, {
      silencePacketCount: session.silencePacketCount,
    });

    if (
      session.aiSpeakFirstEnabled &&
      session.openingGreetingComplete &&
      !session.acceptedCallerAudioAfterOpening &&
      this.isWithinPostOpeningSpeechGate(session)
    ) {
      session.ignoredSpeechPacketCount += 1;
      this.updateRuntimeState(session.streamSid, {
        ignoredSpeechPacketCount: session.ignoredSpeechPacketCount,
      });
      this.recordNoiseIgnored(
        session,
        pcm8.length,
        speech,
        'post_opening_waiting_for_speech',
      );
      return;
    }

    if (!forwardGate.forward) {
      if (session.awaitingCustomerInput && !session.customerTurnConfirmed) {
        session.pendingSpeechPcm8 = [];
        session.pendingSpeechDurationMs = 0;
        session.speechLikePacketCount = 0;
      }
      return;
    }

    if (!session.validCustomerSpeechSinceLastResponse) {
      session.pendingSpeechPcm8 = [];
      session.pendingSpeechDurationMs = 0;
      this.recordNoiseIgnored(session, pcm8.length, speech, 'no_valid_customer_speech');
      return;
    }

    this.appendInputAudioChunk(session, pcm8, false, speech);

    // With server_vad, OpenAI handles turn detection. Silence is forwarded only
    // after valid speech so it can close a real turn, not create one from noise.
  }

  private appendInputAudioChunk(
    session: OpenAiRealtimeSession,
    pcm8: Buffer,
    speechLike: boolean,
    speech: { rms: number; threshold: number },
  ): void {
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
    session.customerAudioAppendedSinceLastResponse = true;

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

  private markCustomerCallEndDetected(
    session: OpenAiRealtimeSession,
    intent: Exclude<CustomerCallEndIntent, null>,
    text: string,
  ): void {
    if (session.callEndDetected) {
      return;
    }

    if (
      this.shouldRequireLocalSpeechForCallEndIntent(session) &&
      !this.hasLocallyValidatedCustomerSpeechSinceAssistantDone(session)
    ) {
      this.logTurnTaking(session, 'voice_call_end_intent_ignored', {
        intent,
        text,
        reason: 'no_local_speech_validation',
      });
      return;
    }

    session.callEndDetected = true;
    session.callEndReason = callEndReasonForIntent(intent);
    this.logger.log({
      streamSid: session.streamSid,
      intent,
      text,
      message: 'voice_call_end_detected',
    });
    this.updateRuntimeState(session.streamSid, {
      callEndDetected: true,
      callEndReason: session.callEndReason,
    });
    this.scheduleCallEndMaxWait(session);

    if (
      !session.responseRequested &&
      !session.responseInProgress &&
      !session.openingGreetingPending
    ) {
      this.logger.log({
        streamSid: session.streamSid,
        intent,
        message: 'voice_call_end_late_transcript_ack_requested',
      });
      this.requestCallEndAcknowledgementResponse(session, intent);
    }
  }

  private requestCallEndAcknowledgementResponse(
    session: OpenAiRealtimeSession,
    intent: Exclude<CustomerCallEndIntent, null>,
  ): void {
    if (session.ws.readyState !== WebSocket.OPEN) {
      this.scheduleHangupAfterCompletion(session);
      return;
    }

    const responseLanguage = resolveSessionResponseLanguage(session);
    try {
      const sent = this.sendResponseCreate(session, 'call_end_ack', {
        modalities: ['audio'],
        instructions: buildCallEndAcknowledgementInstructions(
          intent,
          responseLanguage,
        ),
        max_output_tokens: 40,
      });
      if (!sent) {
        this.scheduleHangupAfterCompletion(session);
        return;
      }
      this.logger.log({
        streamSid: session.streamSid,
        intent,
        responseLanguage,
        message: 'voice_call_end_ack_response_requested',
      });
    } catch (error) {
      this.logger.error({
        streamSid: session.streamSid,
        intent,
        err: error,
        message: 'voice_call_end_ack_response_error',
      });
      session.responseRequested = false;
      this.scheduleHangupAfterCompletion(session);
    }
  }

  private executeCallEndClose(
    session: OpenAiRealtimeSession,
    reason = session.callEndReason ?? 'customer_call_end_intent',
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
      this.executeCallEndClose(
        session,
        `${session.callEndReason ?? 'customer_call_end_intent'}_max_wait`,
      );
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
    this.resetSpeechTurnState(session);
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

    const source: ResponseCreateSource = options?.forceOnEnd
      ? 'session_end'
      : options?.manualFallback
        ? 'manual_fallback'
        : 'customer_speech';

    const gate = shouldAllowResponseCreate({
      awaitingCustomerInput: session.awaitingCustomerInput,
      customerTurnConfirmed: session.customerTurnConfirmed,
      responseRequested: session.responseRequested,
      responseInProgress: session.responseInProgress,
      source,
      forceOnEnd: options?.forceOnEnd,
      manualFallback: options?.manualFallback,
      manualFallbackUsedSinceLastResponse:
        session.manualFallbackUsedSinceLastResponse,
    });

    if (!gate.allowed) {
      this.logResponseCreateSkipped(session, source, gate.skipReason ?? 'blocked', {
        commitReason,
      });
      voiceDebugLog(this.logger, session.streamSid, 'openai_response_create', {
        responseCount: session.responseCreateCount,
        reason: commitReason,
        skipped: 1,
        skipReason: gate.skipReason,
      });
      return;
    }

    if (
      session.useServerVad &&
      !options?.forceOnEnd &&
      !options?.manualFallback &&
      !session.customerTurnConfirmed
    ) {
      return;
    }

    if (!session.customerAudioAppendedSinceLastResponse) {
      this.blockAutoReply(session, 'no_customer_audio_since_last_ai_response', {
        commitReason,
      });
      return;
    }

    if (!this.hasValidRecentSpeech(session)) {
      this.blockAutoReply(session, 'no_recent_valid_customer_speech', {
        commitReason,
        lastRealSpeechAt: session.lastRealSpeechAt,
        recentSpeechMaxAgeMs: this.getRecentSpeechMaxAgeMs(),
      });
      return;
    }

    if (
      session.speechLikePacketCount < this.getSpeechMinPackets() ||
      session.pendingSpeechDurationMs < this.getSpeechMinDurationMs()
    ) {
      this.blockAutoReply(session, 'speech_below_minimum_threshold', {
        commitReason,
        speechLikePacketCount: session.speechLikePacketCount,
        speechMinPackets: this.getSpeechMinPackets(),
        speechDurationMs: Math.round(session.pendingSpeechDurationMs),
        speechMinDurationMs: this.getSpeechMinDurationMs(),
      });
      return;
    }

    if (session.totalInputPcm24Sent === 0) {
      this.blockAutoReply(session, 'no_audio_sent_to_openai', {
        commitReason,
        pendingChunks: session.pendingPcm8.length,
      });
      return;
    }

    session.commitCount += 1;
    session.manualFallbackSpeechDetected = false;
    this.clearManualFallbackSilenceTimer(session);

    const now = new Date();
    session.responseLanguage = resolveSessionResponseLanguage(session);
    session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));

    const turnInstructions = buildTurnResponseInstructions({
      preferredLanguage: session.responseLanguage,
      lockedLanguage: session.languageLock.lockedLanguage,
      wasInterrupted: session.wasInterruptedResponse,
      lastAssistantText: resolveInterruptedAssistantText({
        assistantTranscriptBuffer: session.assistantTranscriptBuffer,
        lastAssistantText:
          session.lastAssistantText ?? session.lastAssistantTranscript,
      }),
    });

    if (session.wasInterruptedResponse) {
      this.logger.log({
        streamSid: session.streamSid,
        interruptedResponseId: session.interruptedResponseId,
        lastAssistantText: session.lastAssistantText ?? session.lastAssistantTranscript,
        message: 'post_interrupt_response_create',
      });
      if (session.lastAssistantText ?? session.lastAssistantTranscript) {
        this.logger.log({
          streamSid: session.streamSid,
          message: 'repeated_response_prevented',
        });
      }
    }

    const responsePayload = turnInstructions
      ? { instructions: turnInstructions }
      : undefined;

    session.wasInterruptedResponse = false;

    const sent = this.sendResponseCreate(
      session,
      source,
      responsePayload,
      {
        forceOnEnd: options?.forceOnEnd,
        manualFallback: options?.manualFallback,
      },
    );
    if (!sent) {
      return;
    }

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
      responseLanguage: session.responseLanguage,
      languageMatchMode: session.languageMatchMode,
      message: 'input_audio_buffer.commit and response.create sent',
    });
    this.logger.log({
      streamSid: session.streamSid,
      detectedCustomerLanguage: session.detectedCustomerLanguage,
      lastCustomerLanguage: session.lastCustomerLanguage,
      responseLanguage: session.responseLanguage,
      languageMatchMode: session.languageMatchMode,
      message: 'voice_response_language_selected',
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: now,
      commitCount: session.commitCount,
      lastCommitAt: now,
      responseLanguage: session.responseLanguage,
      languageMatchMode: session.languageMatchMode,
      incrementOpenAiEvent: 'input_audio_buffer.commit',
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

  private findSessionByWebSocket(
    ws: WebSocket,
  ): OpenAiRealtimeSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) {
        return session;
      }
    }
    return undefined;
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
      this.logger.warn({
        streamSid,
        openaiEvent: type,
        message: 'OpenAI event for unknown streamSid — session map miss',
      });
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

    if (type === 'session.created') {
      session.openAiSessionCreated = true;
      this.callTiming.markByStreamSid(
        streamSid,
        CallTimingEvent.OPENAI_SESSION_CREATED,
      );
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
      if (session.aiSpeakFirstEnabled) {
        this.logger.log({
          streamSid,
          message: 'voice_opening_waiting_for_openai_ready',
        });
      }
      if (session.sessionUpdateSent) {
        this.scheduleSessionInstructionReadyFallback(session);
      }
      this.evaluateOpeningReadiness(session);
      return;
    }

    if (type === 'session.updated') {
      this.markOpenAiInstructionReady(session, 'session.updated');
      this.callTiming.markByStreamSid(
        streamSid,
        CallTimingEvent.OPENAI_SESSION_UPDATED,
      );
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
      this.flushPendingInputIfReady(session);
      return;
    }

    if (type === 'input_audio_buffer.speech_started') {
      const now = new Date();
      if (session.awaitingCustomerInput && !session.customerTurnConfirmed) {
        this.logTurnTaking(session, 'voice_speech_started_ignored', {
          reason: 'awaiting_customer_input',
        });
        return;
      }

      session.manualFallbackSpeechDetected = true;
      this.clearManualFallbackSilenceTimer(session);
      this.logTurnTaking(session, 'voice_input_audio_buffer_speech_started', {
        turnDetection: session.useServerVad ? 'server_vad' : 'manual',
      });
      this.updateRuntimeState(streamSid, {
        lastSpeechLikeAudioAt: now,
        lastSpeechStartedAt: now,
      });
      return;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      const now = new Date();
      this.logTurnTaking(session, 'voice_input_audio_buffer_speech_stopped', {
        turnDetection: session.useServerVad ? 'server_vad' : 'manual',
        customerTurnConfirmed: session.customerTurnConfirmed,
      });
      this.updateRuntimeState(streamSid, {
        lastSpeechStoppedAt: now,
      });

      if (session.awaitingCustomerInput && !session.customerTurnConfirmed) {
        this.clearOpenAiInputBuffer(session, 'speech_stopped_without_customer_turn');
      } else if (session.customerTurnConfirmed) {
        if (session.useServerVad) {
          session.allowNextServerVadResponse = true;
        }
        this.confirmCustomerTurn(session, 'speech_stopped', {
          turnDetection: session.useServerVad ? 'server_vad' : 'manual',
        });
      }
      return;
    }

    if (type === 'input_audio_buffer.committed') {
      const now = new Date();
      this.logTurnTaking(session, 'voice_input_audio_buffer_committed', {
        customerTurnConfirmed: session.customerTurnConfirmed,
        awaitingCustomerInput: session.awaitingCustomerInput,
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
      const transcriptRole = 'user';
      if (!isValidCustomerTranscript(text)) {
        this.logTurnTaking(session, 'voice_input_transcript_ignored', {
          role: transcriptRole,
          reason: 'empty_or_invalid',
          textLength: (text ?? '').trim().length,
        });
        return;
      }

      const endedAtMs = this.resolveTranscriptOffsetMs(session);
      const startedAtMs = session.lastCustomerSpeechAt
        ? this.resolveTranscriptOffsetMs(session, session.lastCustomerSpeechAt)
        : Math.max(0, endedAtMs - 1000);

      void this.voiceTranscriptService
        .handleRealtimeCompleted({
          streamSid,
          callId: this.resolveCallId(streamSid),
          speaker: 'customer',
          text,
          itemId: extractEventItemId(event),
          startedAtMs,
          endedAtMs,
        })
        .catch((error) => {
          this.logger.warn({
            streamSid,
            message: 'transcript_error',
            err: error instanceof Error ? error.message : String(error),
          });
        });

      if (this.isAiTurnActive(session) && !session.bargeInConfirmed) {
        this.logTurnTaking(session, 'voice_input_transcript_ignored', {
          role: transcriptRole,
          reason: 'ai_speaking_without_barge_in_turn_only',
          text,
          textLength: text.length,
        });
        return;
      }

      if (isLikelyAssistantEcho(text, session.lastAssistantTranscript)) {
        this.logTurnTaking(session, 'voice_input_transcript_ignored', {
          role: transcriptRole,
          reason: 'assistant_echo_turn_only',
          text,
          textLength: text.length,
          lastAssistantTranscript: session.lastAssistantTranscript,
        });
        return;
      }

      this.logTurnTaking(session, 'voice_input_transcript_completed', {
        role: transcriptRole,
        text,
        textLength: text.length,
      });

      if (!session.customerTurnConfirmed) {
        this.confirmCustomerTurn(session, 'transcript', {
          text,
          textLength: text.length,
        });
      }

      if (
        session.useServerVad &&
        !this.isAiTurnActive(session) &&
        session.customerAudioAppendedSinceLastResponse
      ) {
        session.allowNextServerVadResponse = true;
        void this.commitInputAndCreateResponse(session, {
          reason: 'transcript_turn_confirmed',
        });
      }

      this.applyCustomerLanguageDetection(session, text);

      const awaitingOpeningAvailability =
        this.isAwaitingOpeningAvailabilityResponse(session);
      const callEndIntent = detectCustomerCallEndIntent(text, {
        awaitingOpeningAvailabilityResponse: awaitingOpeningAvailability,
      });
      if (awaitingOpeningAvailability && callEndIntent === null) {
        session.openingAvailabilityResponseHandled = true;
      }
      if (callEndIntent) {
        session.openingAvailabilityResponseHandled = true;
        this.markCustomerCallEndDetected(session, callEndIntent, text);
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
      const doneItemId =
        extractEventItemId(event) ?? session.assistantTranscriptItemId;
      if (
        shouldSkipAssistantTranscriptDone({
          interruptedAssistantItemId: session.interruptedAssistantItemId,
          doneItemId,
        })
      ) {
        this.commitInterruptedAssistantTranscript(session);
        this.logger.log({
          streamSid,
          itemId: doneItemId,
          message: 'assistant_transcript_done_skipped_after_interrupt',
        });
        session.assistantTranscriptBuffer = '';
        return;
      }

      const text =
        extractTranscriptText(event) ?? session.assistantTranscriptBuffer.trim();
      if (text) {
        session.lastAssistantTranscript = text;
        session.lastAssistantText = text;
        const endedAtMs = this.resolveTranscriptOffsetMs(session);
        const startedAtMs = session.aiSpeakingStartedAt
          ? this.resolveTranscriptOffsetMs(session, session.aiSpeakingStartedAt)
          : Math.max(0, endedAtMs - 2000);
        this.logTurnTaking(session, 'voice_output_transcript_completed', {
          role: 'assistant',
          text,
          textLength: text.length,
        });
        void this.voiceTranscriptService
          .handleRealtimeCompleted({
            streamSid,
            callId: this.resolveCallId(streamSid),
            speaker: 'assistant',
            text,
            itemId: session.assistantTranscriptItemId,
            startedAtMs,
            endedAtMs,
          })
          .catch((error) => {
            this.logger.warn({
              streamSid,
              message: 'transcript_error',
              err: error instanceof Error ? error.message : String(error),
            });
          });
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
      if (session.openingGreetingPending || session.openingIsCurrentResponse) {
        session.openingGreetingPending = false;
        session.openingIsCurrentResponse = false;
        this.logger.error({
          streamSid,
          error: message,
          message: 'voice_opening_failed',
        });
        this.failOpeningWithFallback(session, message);
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
      if (session.openingIsCurrentResponse && !session.openingGreetingComplete) {
        this.failOpeningWithFallback(session, 'Opening response cancelled');
      }
      this.resetResponseGuards(session, 'response_cancelled');
      session.currentResponseId = undefined;
      session.aiSpeakingStartedAt = undefined;
      this.clearManualFallbackSilenceTimer(session);
      this.updateRuntimeState(streamSid, {
        isAiSpeaking: false,
        lastOpenAiEvent: type,
      });
      return;
    }

    if (type === 'conversation.item.truncated') {
      const itemId = extractEventItemId(event);
      const audioEndMs =
        typeof event.audio_end_ms === 'number' ? event.audio_end_ms : undefined;
      this.logger.log({
        streamSid,
        itemId,
        audioEndMs,
        message: 'conversation_item_truncated',
      });
      if (
        itemId &&
        session.interruptedAssistantItemId &&
        itemId === session.interruptedAssistantItemId
      ) {
        session.assistantTranscriptBuffer = '';
      }
      return;
    }

    if (type === 'response.output_item.added') {
      const item = asRecord(event.item);
      if (typeof item?.id === 'string' && item.role === 'assistant') {
        session.assistantTranscriptItemId = item.id;
      }
      return;
    }

    if (type === 'response.created') {
      const authorizedLocally = Boolean(session.pendingAuthorizedResponseSource);
      const authorizedServerVad =
        session.allowNextServerVadResponse || session.customerTurnConfirmed;

      if (!authorizedLocally && !authorizedServerVad) {
        this.tryCancelUnauthorizedResponse(
          session,
          session.awaitingCustomerInput && !session.customerTurnConfirmed
            ? 'response_created_without_customer_input'
            : 'response_created_unauthorized',
        );
        return;
      }

      const responseSource: ResponseCreateSource =
        session.pendingAuthorizedResponseSource ??
        'server_vad';
      session.pendingAuthorizedResponseSource = undefined;
      session.allowNextServerVadResponse = false;

      session.responseInProgress = true;
      session.responseComplete = false;
      session.responseCount += 1;
      session.outboundPcmDownsampler.reset();
      session.outboundMulawBuffer = Buffer.alloc(0);
      session.currentResponseMulawSent = 0;
      session.assistantTranscriptBuffer = '';
      session.assistantTranscriptItemId = extractAssistantItemIdFromResponseCreated(event);
      session.interruptedAssistantItemId = undefined;
      session.truncateSentForItemId = undefined;
      session.interruptedTranscriptCommitted = false;
      session.currentResponseId = extractResponseId(event);
      session.aiSpeakingStartedAt = new Date();
      if (!session.firstResponseCreateAt) {
        session.firstResponseCreateAt = new Date();
      }
      session.responseLanguage = resolveSessionResponseLanguage(session);

      if (session.openingIsCurrentResponse) {
        const now = new Date();
        session.openingGreetingPending = false;
        this.voiceSessionService.updateOpeningState(streamSid, {
          openingResponseCreatedAt: now,
        });
      }

      this.logTurnTaking(session, 'voice_response_create_accepted', {
        source: responseSource,
        responseCount: session.responseCount,
      });
      this.logger.log({
        streamSid,
        message: 'voice_ai_speaking_started',
      });
      this.logger.log({
        streamSid,
        detectedCustomerLanguage: session.detectedCustomerLanguage,
        lastCustomerLanguage: session.lastCustomerLanguage,
        responseLanguage: session.responseLanguage,
        languageMatchMode: session.languageMatchMode,
        message: 'voice_response_language_selected',
      });
      this.updateRuntimeState(streamSid, {
        responseCount: session.responseCount,
        firstResponseCreateAt: session.firstResponseCreateAt,
        responseLanguage: session.responseLanguage,
        preferredLanguage: session.preferredLanguage,
        languageMatchMode: session.languageMatchMode,
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
      if (session.openingIsCurrentResponse && !session.openingGreetingComplete) {
        session.openingAudioDoneAt = now;
        this.voiceSessionService.updateOpeningState(streamSid, {
          openingAudioDoneAt: now,
        });
        this.logger.log({
          streamSid,
          message: 'voice_opening_audio_done',
        });
      }
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
      session.currentResponseId = undefined;
      session.aiSpeakingStartedAt = undefined;
      session.cancelSentForResponseId = undefined;
      session.manualFallbackSpeechDetected = false;
      this.resetSpeechTurnState(session);
      if (
        session.openingIsCurrentResponse &&
        session.openingGreetingRequested &&
        !session.openingGreetingComplete
      ) {
        session.openingIsCurrentResponse = false;
        this.completeOpeningGreeting(session);
      }
      this.clearManualFallbackSilenceTimer(session);
      this.flushOutboundPcmRemainder(session);
      this.flushRemainingOutbound(session);
      this.resolveResponseWaiters(session);
      const now = new Date();
      session.lastAssistantResponseDoneAt = now;
      this.setAwaitingCustomerInput(session, true, 'assistant_response_done');
      this.clearOpenAiInputBuffer(session, 'response_done');
      this.logTurnTaking(session, 'voice_response_pending_changed', {
        responsePending: false,
        responseDoneCount: session.responseDoneCount,
      });
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
        lastAssistantResponseDoneAt: now,
        outboundBufferedBytes: session.outboundMulawBuffer.length,
      });
      if (session.callEndDetected) {
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

    this.callTiming.markByStreamSid(
      session.streamSid,
      CallTimingEvent.FIRST_OPENAI_AUDIO_DELTA,
      { bytes: decoded.length },
      { once: true },
    );

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

    if (
      session.openingIsCurrentResponse &&
      session.openingState === 'opening_response_requested'
    ) {
      const now = new Date();
      session.openingAudioStartedAt = now;
      this.setOpeningState(
        session,
        'opening_audio_playing',
        'voice_opening_audio_started',
      );
      this.voiceSessionService.updateOpeningState(session.streamSid, {
        openingAudioStartedAt: now,
      });
    }

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
      session.currentResponseMulawSent += frame.length;
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

    this.callTiming.markByStreamSid(
      streamSid,
      CallTimingEvent.FIRST_SMARTFLO_OUTBOUND_CHUNK,
      { mulawBytes, outboundMediaCount },
      { once: true },
    );

    this.audioGateway.sendMedia(streamSid, base64MulawPayload);
  }

  private resolveCallId(streamSid: string): string | undefined {
    return this.voiceSessionService.getByStreamSid(streamSid)?.callId;
  }

  private resolveTranscriptOffsetMs(
    session: OpenAiRealtimeSession,
    at: Date = new Date(),
  ): number {
    if (!session.connectedAt) {
      return 0;
    }

    return Math.max(0, at.getTime() - session.connectedAt.getTime());
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
      silencePacketCount?: number;
      ignoredNoisePacketCount?: number;
      ignoredSpeechPacketCount?: number;
      detectedCustomerLanguage?: CustomerLanguage;
      lastCustomerLanguage?: CustomerLanguage;
      preferredLanguage?: CustomerLanguage;
      responseLanguage?: CustomerLanguage;
      languageMatchMode?: 'latest_customer_message' | 'conservative_language_lock';
      firstCustomerSpeechAt?: Date;
      firstResponseCreateAt?: Date;
      startupListenDelayMs?: number;
      autoReplyBlockedCount?: number;
      responseBlockedReason?: string;
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
      lastAssistantResponseDoneAt?: Date;
      lastCustomerSpeechAt?: Date;
      awaitingCustomerInput?: boolean;
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
