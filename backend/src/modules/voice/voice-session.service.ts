import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  mergePcm16Stats,
  Pcm16Stats,
} from './audio/pcm-stats.util';
import { VoiceSharedStateService } from './voice-shared-state.service';
import { VoiceOpeningContext, OpeningState } from './voice-opening.types';
import { CallContext } from './voice-call-context.types';
import { extractCallContextDebugInfo } from './voice-call-context.util';

export type VoiceSessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED';

export type VoiceRuntimeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export interface VoiceSession {
  socketSessionId: string;
  streamSid?: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
  status: VoiceSessionStatus;
  isAppInitiated?: boolean;
  authorizationSource?: string;
  authorizationId?: string;
  callId?: string;
  rejectionReason?: string;
  connectedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  lastEvent?: string;
  lastEventAt?: Date;
  packetsReceived: number;
  lastMediaChunk?: string;
  lastMediaTimestamp?: string;
  lastMediaPayloadLength?: number;
  dtmfDigits: string[];
  marksReceived: string[];
  stopReason?: string | null;
  remoteAddress?: string;
  recordingAvailable?: boolean;
  recordingFileName?: string;
  recordingDurationMsEstimate?: number;
  recordingMulawBytes?: number;
  recordingWavBytes?: number;
  recordingInboundTimelineStartMs?: number | null;
  recordingInboundTimelineEndMs?: number | null;
  recordingOutboundTimelineStartMs?: number | null;
  recordingOutboundTimelineEndMs?: number | null;
  recordingInboundChunkCount?: number;
  recordingOutboundChunkCount?: number;
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
  detectedCustomerLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
  lastCustomerLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
  responseLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
  languageMatchMode?: 'latest_customer_message';
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
  manualFallbackCommitCount?: number;
  speechLikeFrameCount?: number;
  silenceFrameCount?: number;
  openAiEventCounts?: Record<string, number>;
  inboundPeakAmplitude?: number;
  inboundAvgAmplitude?: number;
  inboundRms?: number;
  outboundPeakAmplitude?: number;
  outboundAvgAmplitude?: number;
  outboundRms?: number;
  audioGainApplied?: number;
  outboundBytesSent?: number;
  outboundBufferedBytes?: number;
  outboundFinalFlushAt?: Date;
  outboundFirstSentAt?: Date;
  outboundLastSentAt?: Date;
  outboundChunkMinBytes?: number;
  outboundChunkMaxBytes?: number;
  outboundChunkTotalBytes?: number;
  outboundChunkSendCount?: number;
  smartfloWsReadyState?: number;
  smartfloSendErrors?: number;
  lastSmartfloSendAt?: Date;
  openingContext?: VoiceOpeningContext;
  aiSpeakFirstEnabled?: boolean;
  openingState?: OpeningState;
  openingRequestedAt?: Date;
  openingResponseCreatedAt?: Date;
  openingAudioStartedAt?: Date;
  openingAudioDoneAt?: Date;
  openingDoneAt?: Date;
  openingError?: string;
  normalModeActivatedAt?: Date;
  openingSuppressedInboundPackets?: number;
  openingGreetingRequestedAt?: Date;
  openingGreetingResponseCreatedAt?: Date;
  openingGreetingError?: string;
  callContext?: CallContext;
  hasCallContext?: boolean;
  callContextKeys?: string[];
  callContextBookingNumber?: string;
  callContextCustomerName?: string;
  callEndDetected?: boolean;
  callEndReason?: string;
  callEndScheduledAt?: Date;
  callEndCloseAt?: Date;
  callEndCloseError?: string;
  transcriptMode?: string;
  realtimeTranscriptCount?: number;
  finalTranscriptStatus?: 'none' | 'draft' | 'processing' | 'final' | 'failed';
  transcriptError?: string;
  transcriptLanguageDetected?: 'hi' | 'en' | 'mixed' | 'unknown';
}

export interface VoiceSessionStartData {
  streamSid: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
}

export interface VoiceSessionResponse {
  socketSessionId: string;
  streamSid?: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
  status: VoiceSessionStatus;
  isAppInitiated?: boolean;
  authorizationSource?: string;
  authorizationId?: string;
  callId?: string;
  rejectionReason?: string;
  connectedAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  lastEvent?: string;
  lastEventAt?: string;
  packetsReceived: number;
  lastMediaChunk?: string;
  lastMediaTimestamp?: string;
  lastMediaPayloadLength?: number;
  dtmfDigits: string[];
  marksReceived: string[];
  stopReason?: string | null;
  remoteAddress?: string;
  recordingAvailable?: boolean;
  recordingFileName?: string;
  recordingDurationMsEstimate?: number;
  recordingMulawBytes?: number;
  recordingWavBytes?: number;
  recordingInboundTimelineStartMs?: number | null;
  recordingInboundTimelineEndMs?: number | null;
  recordingOutboundTimelineStartMs?: number | null;
  recordingOutboundTimelineEndMs?: number | null;
  recordingInboundChunkCount?: number;
  recordingOutboundChunkCount?: number;
  runtimeProvider?: string;
  runtimeStatus?: VoiceRuntimeStatus;
  runtimeConnectedAt?: string;
  runtimeLastEventAt?: string;
  runtimeError?: string;
  activePlaybookId?: string;
  activePlaybookVersion?: number;
  playbookInjected?: boolean;
  playbookLoadError?: string;
  activeInstructionsMode?: 'opening' | 'normal';
  openingCompletedAt?: string;
  inboundSuppressedCount?: number;
  inboundSuppressedReason?: string;
  postOpeningIgnoreUntil?: string;
  speechLikePacketCount?: number;
  silencePacketCount?: number;
  ignoredNoisePacketCount?: number;
  ignoredSpeechPacketCount?: number;
  detectedCustomerLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
  lastCustomerLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
  responseLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
  languageMatchMode?: 'latest_customer_message';
  firstCustomerSpeechAt?: string;
  firstResponseCreateAt?: string;
  startupListenDelayMs?: number;
  autoReplyBlockedCount?: number;
  responseBlockedReason?: string;
  isOpenAiConnected?: boolean;
  hasReceivedCallerAudio?: boolean;
  lastCallerAudioAt?: string;
  lastMediaAt?: string;
  lastSpeechLikeAudioAt?: string;
  lastOpenAiAppendAt?: string;
  lastSpeechStartedAt?: string;
  lastSpeechStoppedAt?: string;
  lastCommitAt?: string;
  lastResponseCreateAt?: string;
  lastResponseDoneAt?: string;
  lastOpenAiAudioDoneAt?: string;
  lastOpenAiEvent?: string;
  lastError?: string;
  responsePending?: boolean;
  isAwaitingOpenAiResponse?: boolean;
  isAiSpeaking?: boolean;
  lastOpenAiAudioAt?: string;
  responseCount?: number;
  responseCreateCount?: number;
  responseDoneCount?: number;
  appendCount?: number;
  commitCount?: number;
  outboundMediaCount?: number;
  manualFallbackCommitCount?: number;
  speechLikeFrameCount?: number;
  silenceFrameCount?: number;
  openAiEventCounts?: Record<string, number>;
  inboundPeakAmplitude?: number;
  inboundAvgAmplitude?: number;
  inboundRms?: number;
  outboundPeakAmplitude?: number;
  outboundAvgAmplitude?: number;
  outboundRms?: number;
  audioGainApplied?: number;
  outboundBytesSent?: number;
  outboundBufferedBytes?: number | null;
  outboundFinalFlushAt?: string | null;
  outboundFirstSentAt?: string | null;
  outboundLastSentAt?: string | null;
  outboundChunkMinBytes?: number | null;
  outboundChunkMaxBytes?: number | null;
  outboundChunkAvgBytes?: number | null;
  smartfloWsReadyState?: number | null;
  smartfloSendErrors?: number;
  lastSmartfloSendAt?: string | null;
  openingContext?: VoiceOpeningContext;
  aiSpeakFirstEnabled?: boolean;
  openingState?: OpeningState;
  openingRequestedAt?: string | null;
  openingResponseCreatedAt?: string | null;
  openingAudioStartedAt?: string | null;
  openingAudioDoneAt?: string | null;
  openingDoneAt?: string | null;
  openingError?: string | null;
  normalModeActivatedAt?: string | null;
  openingSuppressedInboundPackets?: number;
  openingGreetingRequestedAt?: string | null;
  openingGreetingResponseCreatedAt?: string | null;
  openingGreetingError?: string | null;
  hasCallContext?: boolean;
  callContextKeys?: string[];
  callContextBookingNumber?: string | null;
  callContextCustomerName?: string | null;
  callEndDetected?: boolean;
  callEndReason?: string;
  callEndScheduledAt?: string | null;
  callEndCloseAt?: string | null;
  callEndCloseError?: string;
  transcriptMode?: string;
  realtimeTranscriptCount?: number;
  finalTranscriptStatus?: 'none' | 'draft' | 'processing' | 'final' | 'failed';
  transcriptError?: string;
  transcriptLanguageDetected?: 'hi' | 'en' | 'mixed' | 'unknown';
}

const MAX_RECENT_ENDED_SESSIONS = 100;

function toIso(date: Date | undefined): string | null | undefined {
  if (date === undefined) {
    return undefined;
  }
  return date ? date.toISOString() : null;
}

export function toVoiceSessionResponse(
  session: VoiceSession,
): VoiceSessionResponse {
  return {
    socketSessionId: session.socketSessionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    accountSid: session.accountSid,
    from: session.from,
    to: session.to,
    direction: session.direction,
    mediaFormat: session.mediaFormat,
    customParameters: session.customParameters,
    status: session.status,
    isAppInitiated: session.isAppInitiated,
    authorizationSource: session.authorizationSource,
    authorizationId: session.authorizationId,
    rejectionReason: session.rejectionReason,
    connectedAt: session.connectedAt.toISOString(),
    startedAt: toIso(session.startedAt) ?? null,
    endedAt: toIso(session.endedAt) ?? null,
    lastEvent: session.lastEvent,
    lastEventAt: session.lastEventAt?.toISOString(),
    packetsReceived: session.packetsReceived,
    lastMediaChunk: session.lastMediaChunk,
    lastMediaTimestamp: session.lastMediaTimestamp,
    lastMediaPayloadLength: session.lastMediaPayloadLength,
    dtmfDigits: [...session.dtmfDigits],
    marksReceived: [...session.marksReceived],
    stopReason: session.stopReason ?? null,
    remoteAddress: session.remoteAddress,
    recordingAvailable: session.recordingAvailable ?? false,
    recordingFileName: session.recordingFileName,
    recordingDurationMsEstimate: session.recordingDurationMsEstimate,
    recordingMulawBytes: session.recordingMulawBytes,
    recordingWavBytes: session.recordingWavBytes,
    recordingInboundTimelineStartMs: session.recordingInboundTimelineStartMs ?? null,
    recordingInboundTimelineEndMs: session.recordingInboundTimelineEndMs ?? null,
    recordingOutboundTimelineStartMs: session.recordingOutboundTimelineStartMs ?? null,
    recordingOutboundTimelineEndMs: session.recordingOutboundTimelineEndMs ?? null,
    recordingInboundChunkCount: session.recordingInboundChunkCount,
    recordingOutboundChunkCount: session.recordingOutboundChunkCount,
    runtimeProvider: session.runtimeProvider,
    runtimeStatus: session.runtimeStatus,
    runtimeConnectedAt: session.runtimeConnectedAt?.toISOString(),
    runtimeLastEventAt: session.runtimeLastEventAt?.toISOString(),
    runtimeError: session.runtimeError,
    activePlaybookId: session.activePlaybookId,
    activePlaybookVersion: session.activePlaybookVersion,
    playbookInjected: session.playbookInjected,
    playbookLoadError: session.playbookLoadError,
    activeInstructionsMode: session.activeInstructionsMode,
    openingCompletedAt: session.openingCompletedAt?.toISOString(),
    inboundSuppressedCount: session.inboundSuppressedCount,
    inboundSuppressedReason: session.inboundSuppressedReason,
    postOpeningIgnoreUntil: session.postOpeningIgnoreUntil?.toISOString(),
    speechLikePacketCount: session.speechLikePacketCount,
    silencePacketCount: session.silencePacketCount,
    ignoredNoisePacketCount: session.ignoredNoisePacketCount,
    ignoredSpeechPacketCount: session.ignoredSpeechPacketCount,
    detectedCustomerLanguage: session.detectedCustomerLanguage,
    lastCustomerLanguage: session.lastCustomerLanguage,
    responseLanguage: session.responseLanguage,
    languageMatchMode: session.languageMatchMode,
    firstCustomerSpeechAt: session.firstCustomerSpeechAt?.toISOString(),
    firstResponseCreateAt: session.firstResponseCreateAt?.toISOString(),
    startupListenDelayMs: session.startupListenDelayMs,
    autoReplyBlockedCount: session.autoReplyBlockedCount,
    responseBlockedReason: session.responseBlockedReason,
    isOpenAiConnected: session.isOpenAiConnected,
    hasReceivedCallerAudio: session.hasReceivedCallerAudio,
    lastCallerAudioAt: session.lastCallerAudioAt?.toISOString(),
    lastMediaAt: session.lastMediaAt?.toISOString(),
    lastSpeechLikeAudioAt: session.lastSpeechLikeAudioAt?.toISOString(),
    lastOpenAiAppendAt: session.lastOpenAiAppendAt?.toISOString(),
    lastSpeechStartedAt: session.lastSpeechStartedAt?.toISOString(),
    lastSpeechStoppedAt: session.lastSpeechStoppedAt?.toISOString(),
    lastCommitAt: session.lastCommitAt?.toISOString(),
    lastResponseCreateAt: session.lastResponseCreateAt?.toISOString(),
    lastResponseDoneAt: session.lastResponseDoneAt?.toISOString(),
    lastOpenAiAudioDoneAt: session.lastOpenAiAudioDoneAt?.toISOString(),
    lastOpenAiEvent: session.lastOpenAiEvent,
    lastError: session.lastError,
    responsePending: session.responsePending,
    isAwaitingOpenAiResponse: session.isAwaitingOpenAiResponse,
    isAiSpeaking: session.isAiSpeaking,
    lastOpenAiAudioAt: session.lastOpenAiAudioAt?.toISOString(),
    responseCount: session.responseCount,
    responseCreateCount: session.responseCreateCount,
    responseDoneCount: session.responseDoneCount,
    appendCount: session.appendCount,
    commitCount: session.commitCount,
    outboundMediaCount: session.outboundMediaCount,
    manualFallbackCommitCount: session.manualFallbackCommitCount,
    speechLikeFrameCount: session.speechLikeFrameCount,
    silenceFrameCount: session.silenceFrameCount,
    openAiEventCounts: session.openAiEventCounts
      ? { ...session.openAiEventCounts }
      : undefined,
    inboundPeakAmplitude: session.inboundPeakAmplitude,
    inboundAvgAmplitude: session.inboundAvgAmplitude,
    inboundRms: session.inboundRms,
    outboundPeakAmplitude: session.outboundPeakAmplitude,
    outboundAvgAmplitude: session.outboundAvgAmplitude,
    outboundRms: session.outboundRms,
    audioGainApplied: session.audioGainApplied,
    outboundBytesSent: session.outboundBytesSent,
    outboundBufferedBytes: session.outboundBufferedBytes ?? null,
    outboundFinalFlushAt: session.outboundFinalFlushAt?.toISOString() ?? null,
    outboundFirstSentAt: session.outboundFirstSentAt?.toISOString() ?? null,
    outboundLastSentAt: session.outboundLastSentAt?.toISOString() ?? null,
    outboundChunkMinBytes: session.outboundChunkMinBytes ?? null,
    outboundChunkMaxBytes: session.outboundChunkMaxBytes ?? null,
    outboundChunkAvgBytes:
      session.outboundChunkSendCount && session.outboundChunkSendCount > 0
        ? Number(
            (
              (session.outboundChunkTotalBytes ?? 0) /
              session.outboundChunkSendCount
            ).toFixed(2),
          )
        : null,
    smartfloWsReadyState: session.smartfloWsReadyState ?? null,
    smartfloSendErrors: session.smartfloSendErrors,
    lastSmartfloSendAt: session.lastSmartfloSendAt?.toISOString() ?? null,
    openingContext: session.openingContext,
    aiSpeakFirstEnabled: session.aiSpeakFirstEnabled,
    openingState: session.openingState,
    openingRequestedAt: session.openingRequestedAt?.toISOString() ?? null,
    openingResponseCreatedAt:
      session.openingResponseCreatedAt?.toISOString() ?? null,
    openingAudioStartedAt: session.openingAudioStartedAt?.toISOString() ?? null,
    openingAudioDoneAt: session.openingAudioDoneAt?.toISOString() ?? null,
    openingDoneAt: session.openingDoneAt?.toISOString() ?? null,
    openingError: session.openingError ?? null,
    normalModeActivatedAt: session.normalModeActivatedAt?.toISOString() ?? null,
    openingSuppressedInboundPackets: session.openingSuppressedInboundPackets,
    openingGreetingRequestedAt:
      session.openingGreetingRequestedAt?.toISOString() ?? null,
    openingGreetingResponseCreatedAt:
      session.openingGreetingResponseCreatedAt?.toISOString() ?? null,
    openingGreetingError: session.openingGreetingError ?? null,
    hasCallContext: session.hasCallContext ?? false,
    callContextKeys: session.callContextKeys ?? [],
    callContextBookingNumber: session.callContextBookingNumber ?? null,
    callContextCustomerName: session.callContextCustomerName ?? null,
    callEndDetected: session.callEndDetected,
    callEndReason: session.callEndReason,
    callEndScheduledAt: session.callEndScheduledAt?.toISOString() ?? null,
    callEndCloseAt: session.callEndCloseAt?.toISOString() ?? null,
    callEndCloseError: session.callEndCloseError,
    callId: session.callId,
    transcriptMode: session.transcriptMode,
    realtimeTranscriptCount: session.realtimeTranscriptCount,
    finalTranscriptStatus: session.finalTranscriptStatus,
    transcriptError: session.transcriptError,
    transcriptLanguageDetected: session.transcriptLanguageDetected,
  };
}

function parseOptionalDate(value: string | null | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

export function fromVoiceSessionResponse(
  response: VoiceSessionResponse,
): VoiceSession {
  return {
    ...response,
    connectedAt: new Date(response.connectedAt),
    startedAt: parseOptionalDate(response.startedAt ?? undefined),
    endedAt: parseOptionalDate(response.endedAt ?? undefined),
    lastEventAt: parseOptionalDate(response.lastEventAt),
    runtimeConnectedAt: parseOptionalDate(response.runtimeConnectedAt),
    runtimeLastEventAt: parseOptionalDate(response.runtimeLastEventAt),
    openingCompletedAt: parseOptionalDate(response.openingCompletedAt),
    postOpeningIgnoreUntil: parseOptionalDate(response.postOpeningIgnoreUntil),
    firstCustomerSpeechAt: parseOptionalDate(response.firstCustomerSpeechAt),
    firstResponseCreateAt: parseOptionalDate(response.firstResponseCreateAt),
    lastCallerAudioAt: parseOptionalDate(response.lastCallerAudioAt),
    lastMediaAt: parseOptionalDate(response.lastMediaAt),
    lastSpeechLikeAudioAt: parseOptionalDate(response.lastSpeechLikeAudioAt),
    lastOpenAiAppendAt: parseOptionalDate(response.lastOpenAiAppendAt),
    lastSpeechStartedAt: parseOptionalDate(response.lastSpeechStartedAt),
    lastSpeechStoppedAt: parseOptionalDate(response.lastSpeechStoppedAt),
    lastCommitAt: parseOptionalDate(response.lastCommitAt),
    lastResponseCreateAt: parseOptionalDate(response.lastResponseCreateAt),
    lastResponseDoneAt: parseOptionalDate(response.lastResponseDoneAt),
    lastOpenAiAudioDoneAt: parseOptionalDate(response.lastOpenAiAudioDoneAt),
    lastOpenAiAudioAt: parseOptionalDate(response.lastOpenAiAudioAt),
    outboundFirstSentAt: parseOptionalDate(response.outboundFirstSentAt),
    outboundLastSentAt: parseOptionalDate(response.outboundLastSentAt),
    outboundFinalFlushAt: parseOptionalDate(response.outboundFinalFlushAt),
    lastSmartfloSendAt: parseOptionalDate(response.lastSmartfloSendAt),
    openingGreetingRequestedAt: parseOptionalDate(
      response.openingGreetingRequestedAt ?? undefined,
    ),
    openingGreetingResponseCreatedAt: parseOptionalDate(
      response.openingGreetingResponseCreatedAt ?? undefined,
    ),
    openingRequestedAt: parseOptionalDate(response.openingRequestedAt ?? undefined),
    openingResponseCreatedAt: parseOptionalDate(
      response.openingResponseCreatedAt ?? undefined,
    ),
    openingAudioStartedAt: parseOptionalDate(
      response.openingAudioStartedAt ?? undefined,
    ),
    openingAudioDoneAt: parseOptionalDate(response.openingAudioDoneAt ?? undefined),
    openingDoneAt: parseOptionalDate(response.openingDoneAt ?? undefined),
    normalModeActivatedAt: parseOptionalDate(
      response.normalModeActivatedAt ?? undefined,
    ),
    openingContext: response.openingContext,
    openingGreetingError: nullToUndefined(response.openingGreetingError),
    openingError: nullToUndefined(response.openingError),
    callEndScheduledAt: parseOptionalDate(response.callEndScheduledAt),
    callEndCloseAt: parseOptionalDate(response.callEndCloseAt),
    stopReason: nullToUndefined(response.stopReason),
    recordingInboundTimelineStartMs: nullToUndefined(
      response.recordingInboundTimelineStartMs,
    ),
    recordingInboundTimelineEndMs: nullToUndefined(
      response.recordingInboundTimelineEndMs,
    ),
    recordingOutboundTimelineStartMs: nullToUndefined(
      response.recordingOutboundTimelineStartMs,
    ),
    recordingOutboundTimelineEndMs: nullToUndefined(
      response.recordingOutboundTimelineEndMs,
    ),
    outboundBufferedBytes: nullToUndefined(response.outboundBufferedBytes),
    outboundChunkMinBytes: nullToUndefined(response.outboundChunkMinBytes),
    outboundChunkMaxBytes: nullToUndefined(response.outboundChunkMaxBytes),
    smartfloWsReadyState: nullToUndefined(response.smartfloWsReadyState),
  };
}

@Injectable()
export class VoiceSessionService {
  private readonly activeBySocketSessionId = new Map<string, VoiceSession>();
  private readonly activeByStreamSid = new Map<string, VoiceSession>();
  private readonly socketToStreamSid = new Map<string, string>();
  private readonly recentEndedSessions: VoiceSession[] = [];
  private readonly recentEndedByStreamSid = new Map<string, VoiceSession>();
  private readonly inboundStatsByStreamSid = new Map<string, Pcm16Stats>();
  private readonly outboundStatsByStreamSid = new Map<string, Pcm16Stats>();
  private readonly authorizationPending = new Set<string>();

  constructor(
    private readonly voiceSharedStateService: VoiceSharedStateService,
  ) {}

  createSocketSession(remoteAddress?: string): VoiceSession {
    const socketSessionId = randomUUID();
    const session: VoiceSession = {
      socketSessionId,
      remoteAddress,
      connectedAt: new Date(),
      status: 'PENDING',
      packetsReceived: 0,
      dtmfDigits: [],
      marksReceived: [],
    };
    this.activeBySocketSessionId.set(socketSessionId, session);
    return session;
  }

  getBySocketSessionId(socketSessionId: string): VoiceSession | undefined {
    return (
      this.activeBySocketSessionId.get(socketSessionId) ??
      this.recentEndedSessions.find(
        (session) => session.socketSessionId === socketSessionId,
      )
    );
  }

  getByStreamSid(streamSid: string): VoiceSession | undefined {
    return (
      this.activeByStreamSid.get(streamSid) ??
      this.recentEndedByStreamSid.get(streamSid)
    );
  }

  async resolveByStreamSid(streamSid: string): Promise<VoiceSession | undefined> {
    const local = this.getByStreamSid(streamSid);
    if (local) {
      return local;
    }

    const shared =
      await this.voiceSharedStateService.getEndedSessionByStreamSid(streamSid);
    return shared ? fromVoiceSessionResponse(shared) : undefined;
  }

  getActiveSessions(): VoiceSession[] {
    return Array.from(this.activeBySocketSessionId.values()).filter(
      (session) => session.isAppInitiated === true,
    );
  }

  async getRecentEndedSessions(): Promise<VoiceSession[]> {
    const local = this.recentEndedSessions.filter(
      (session) => session.isAppInitiated === true,
    );
    const shared = await this.voiceSharedStateService.listRecentEndedSessions();

    const merged = new Map<string, VoiceSession>();
    for (const session of shared.map(fromVoiceSessionResponse)) {
      if (session.streamSid) {
        merged.set(session.streamSid, session);
      }
    }
    for (const session of local) {
      if (session.streamSid) {
        merged.set(session.streamSid, session);
      }
    }

    return [...merged.values()].sort(
      (a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0),
    );
  }

  async getSessionCounts(): Promise<{ active: number; recentEnded: number }> {
    const recentEnded = await this.getRecentEndedSessions();
    return {
      active: this.getActiveSessions().length,
      recentEnded: recentEnded.length,
    };
  }

  isAppInitiatedStream(streamSid: string): boolean {
    const session = this.getByStreamSid(streamSid);
    if (session?.isAppInitiated === true) {
      return true;
    }
    if (session?.isAppInitiated === false) {
      return false;
    }
    return this.authorizationPending.has(streamSid);
  }

  markAuthorizationPending(streamSid: string): void {
    this.authorizationPending.add(streamSid);
  }

  clearAuthorizationPending(streamSid: string): void {
    this.authorizationPending.delete(streamSid);
  }

  markAppInitiated(
    streamSid: string,
    appInitiated: boolean,
    metadata?: {
      authorizationSource?: string;
      authorizationId?: string;
      callId?: string;
      rejectionReason?: string;
    },
  ): void {
    const session = this.activeByStreamSid.get(streamSid);
    if (!session) {
      return;
    }

    session.isAppInitiated = appInitiated;
    session.authorizationSource = metadata?.authorizationSource;
    session.authorizationId = metadata?.authorizationId;
    session.callId = metadata?.callId;
    session.rejectionReason = metadata?.rejectionReason;
  }

  updateTranscriptState(
    streamSid: string,
    update: {
      callId?: string;
      transcriptMode?: string;
      realtimeTranscriptCount?: number;
      incrementRealtimeTranscriptCount?: boolean;
      finalTranscriptStatus?: 'none' | 'draft' | 'processing' | 'final' | 'failed';
      transcriptError?: string;
      transcriptLanguageDetected?: 'hi' | 'en' | 'mixed' | 'unknown';
    },
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    if (update.callId !== undefined) {
      session.callId = update.callId;
    }
    if (update.transcriptMode !== undefined) {
      session.transcriptMode = update.transcriptMode;
    }
    if (update.realtimeTranscriptCount !== undefined) {
      session.realtimeTranscriptCount = update.realtimeTranscriptCount;
    } else if (update.incrementRealtimeTranscriptCount) {
      session.realtimeTranscriptCount = (session.realtimeTranscriptCount ?? 0) + 1;
    }
    if (update.finalTranscriptStatus !== undefined) {
      session.finalTranscriptStatus = update.finalTranscriptStatus;
    }
    if (update.transcriptError !== undefined) {
      session.transcriptError = update.transcriptError;
    }
    if (update.transcriptLanguageDetected !== undefined) {
      session.transcriptLanguageDetected = update.transcriptLanguageDetected;
    }
  }

  setOpeningContext(streamSid: string, openingContext: VoiceOpeningContext): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    session.openingContext = openingContext;
  }

  setCallContext(streamSid: string, callContext?: CallContext): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    session.callContext = callContext;
    const debug = extractCallContextDebugInfo(callContext);
    session.hasCallContext = debug.hasCallContext;
    session.callContextKeys = debug.callContextKeys;
    session.callContextBookingNumber = debug.bookingNumber;
    session.callContextCustomerName = debug.customerName;
  }

  initializeSpeakFirstState(
    streamSid: string,
    update: {
      aiSpeakFirstEnabled: boolean;
      openingState: OpeningState;
      openingContext?: VoiceOpeningContext;
    },
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    session.aiSpeakFirstEnabled = update.aiSpeakFirstEnabled;
    session.openingState = update.openingState;
    if (update.openingContext !== undefined) {
      session.openingContext = update.openingContext;
    }
  }

  updateOpeningState(
    streamSid: string,
    update: {
      aiSpeakFirstEnabled?: boolean;
      openingState?: OpeningState;
      openingContext?: VoiceOpeningContext;
      openingRequestedAt?: Date;
      openingResponseCreatedAt?: Date;
      openingAudioStartedAt?: Date;
      openingAudioDoneAt?: Date;
      openingDoneAt?: Date;
      openingError?: string;
      normalModeActivatedAt?: Date;
      openingSuppressedInboundPackets?: number;
      postOpeningIgnoreUntil?: Date;
      openingGreetingRequestedAt?: Date;
      openingGreetingResponseCreatedAt?: Date;
      openingGreetingError?: string;
    },
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    if (update.aiSpeakFirstEnabled !== undefined) {
      session.aiSpeakFirstEnabled = update.aiSpeakFirstEnabled;
    }
    if (update.openingState !== undefined) {
      session.openingState = update.openingState;
    }
    if (update.openingContext !== undefined) {
      session.openingContext = update.openingContext;
    }
    if (update.openingRequestedAt !== undefined) {
      session.openingRequestedAt = update.openingRequestedAt;
      session.openingGreetingRequestedAt = update.openingRequestedAt;
    }
    if (update.openingResponseCreatedAt !== undefined) {
      session.openingResponseCreatedAt = update.openingResponseCreatedAt;
      session.openingGreetingResponseCreatedAt = update.openingResponseCreatedAt;
    }
    if (update.openingAudioStartedAt !== undefined) {
      session.openingAudioStartedAt = update.openingAudioStartedAt;
    }
    if (update.openingAudioDoneAt !== undefined) {
      session.openingAudioDoneAt = update.openingAudioDoneAt;
    }
    if (update.openingDoneAt !== undefined) {
      session.openingDoneAt = update.openingDoneAt;
    }
    if (update.openingError !== undefined) {
      session.openingError = update.openingError;
      session.openingGreetingError = update.openingError;
    }
    if (update.normalModeActivatedAt !== undefined) {
      session.normalModeActivatedAt = update.normalModeActivatedAt;
    }
    if (update.openingSuppressedInboundPackets !== undefined) {
      session.openingSuppressedInboundPackets =
        update.openingSuppressedInboundPackets;
    }
    if (update.postOpeningIgnoreUntil !== undefined) {
      session.postOpeningIgnoreUntil = update.postOpeningIgnoreUntil;
    }
    if (update.openingGreetingRequestedAt !== undefined) {
      session.openingGreetingRequestedAt = update.openingGreetingRequestedAt;
      session.openingRequestedAt = update.openingGreetingRequestedAt;
    }
    if (update.openingGreetingResponseCreatedAt !== undefined) {
      session.openingGreetingResponseCreatedAt =
        update.openingGreetingResponseCreatedAt;
      session.openingResponseCreatedAt = update.openingGreetingResponseCreatedAt;
    }
    if (update.openingGreetingError !== undefined) {
      session.openingGreetingError = update.openingGreetingError;
      session.openingError = update.openingGreetingError;
    }
  }

  recordConnected(socketSessionId: string): void {
    const session = this.activeBySocketSessionId.get(socketSessionId);
    if (!session) {
      return;
    }

    session.lastEvent = 'connected';
    session.lastEventAt = new Date();
  }

  bindStreamSid(
    socketSessionId: string,
    data: VoiceSessionStartData,
  ): VoiceSession | undefined {
    const session = this.activeBySocketSessionId.get(socketSessionId);
    if (!session) {
      return undefined;
    }

    const now = new Date();
    session.streamSid = data.streamSid;
    session.callSid = data.callSid;
    session.accountSid = data.accountSid;
    session.from = data.from;
    session.to = data.to;
    session.direction = data.direction;
    session.mediaFormat = data.mediaFormat;
    session.customParameters = data.customParameters;
    session.status = 'ACTIVE';
    session.startedAt = now;
    session.lastEvent = 'start';
    session.lastEventAt = now;

    this.activeByStreamSid.set(data.streamSid, session);
    this.socketToStreamSid.set(socketSessionId, data.streamSid);
    return session;
  }

  resolveStreamSid(
    payloadStreamSid: unknown,
    socketSessionId: string,
  ): string | undefined {
    if (typeof payloadStreamSid === 'string' && payloadStreamSid.length > 0) {
      return payloadStreamSid;
    }
    return this.socketToStreamSid.get(socketSessionId);
  }

  private resolveActiveSession(
    socketSessionId: string,
    payloadStreamSid: unknown,
  ): VoiceSession | undefined {
    const streamSid = this.resolveStreamSid(payloadStreamSid, socketSessionId);
    if (streamSid) {
      const byStream = this.activeByStreamSid.get(streamSid);
      if (byStream) {
        return byStream;
      }
    }
    return this.activeBySocketSessionId.get(socketSessionId);
  }

  recordMedia(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    const now = new Date();
    session.packetsReceived += 1;
    session.lastEvent = 'media';
    session.lastEventAt = now;
    session.lastMediaAt = now;

    const media =
      payload.media && typeof payload.media === 'object'
        ? (payload.media as Record<string, unknown>)
        : undefined;

    if (media) {
      if (media.chunk !== undefined && media.chunk !== null) {
        session.lastMediaChunk = String(media.chunk);
      }
      if (media.timestamp !== undefined && media.timestamp !== null) {
        session.lastMediaTimestamp = String(media.timestamp);
      }
      if (typeof media.payload === 'string') {
        session.lastMediaPayloadLength = media.payload.length;
      }
    }
  }

  recordDtmf(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    const dtmf =
      payload.dtmf && typeof payload.dtmf === 'object'
        ? (payload.dtmf as Record<string, unknown>)
        : undefined;
    const digit = dtmf?.digit;

    if (typeof digit === 'string' && digit.length > 0) {
      session.dtmfDigits.push(digit);
    }

    session.lastEvent = 'dtmf';
    session.lastEventAt = new Date();
  }

  recordMark(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    const mark =
      payload.mark && typeof payload.mark === 'object'
        ? (payload.mark as Record<string, unknown>)
        : undefined;
    const name = mark?.name;

    if (typeof name === 'string' && name.length > 0) {
      session.marksReceived.push(name);
    }

    session.lastEvent = 'mark';
    session.lastEventAt = new Date();
  }

  recordClear(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    session.lastEvent = 'clear';
    session.lastEventAt = new Date();
  }

  updateRuntimeState(
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
      detectedCustomerLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
      lastCustomerLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
      responseLanguage?: 'english' | 'hindi' | 'hinglish' | 'unknown';
      languageMatchMode?: 'latest_customer_message';
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
      incrementSpeechLikeFrame?: boolean;
      incrementSilenceFrame?: boolean;
      openAiEventCounts?: Record<string, number>;
      incrementOpenAiEvent?: string;
    },
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    if (update.runtimeProvider !== undefined) {
      session.runtimeProvider = update.runtimeProvider;
    }
    if (update.runtimeStatus !== undefined) {
      session.runtimeStatus = update.runtimeStatus;
      if (update.runtimeStatus === 'connected') {
        session.isOpenAiConnected = true;
      } else if (
        update.runtimeStatus === 'closed' ||
        update.runtimeStatus === 'error'
      ) {
        session.isOpenAiConnected = false;
      }
    }
    if (update.runtimeConnectedAt !== undefined) {
      session.runtimeConnectedAt = update.runtimeConnectedAt;
    }
    if (update.runtimeLastEventAt !== undefined) {
      session.runtimeLastEventAt = update.runtimeLastEventAt;
    }
    if (update.runtimeError !== undefined) {
      session.runtimeError = update.runtimeError;
    }
    if (update.activePlaybookId !== undefined) {
      session.activePlaybookId = update.activePlaybookId;
    }
    if (update.activePlaybookVersion !== undefined) {
      session.activePlaybookVersion = update.activePlaybookVersion;
    }
    if (update.playbookInjected !== undefined) {
      session.playbookInjected = update.playbookInjected;
    }
    if (update.playbookLoadError !== undefined) {
      session.playbookLoadError = update.playbookLoadError;
    }
    if (update.activeInstructionsMode !== undefined) {
      session.activeInstructionsMode = update.activeInstructionsMode;
    }
    if (update.openingCompletedAt !== undefined) {
      session.openingCompletedAt = update.openingCompletedAt;
    }
    if (update.inboundSuppressedCount !== undefined) {
      session.inboundSuppressedCount = update.inboundSuppressedCount;
    }
    if (update.inboundSuppressedReason !== undefined) {
      session.inboundSuppressedReason = update.inboundSuppressedReason;
    }
    if (update.postOpeningIgnoreUntil !== undefined) {
      session.postOpeningIgnoreUntil = update.postOpeningIgnoreUntil;
    }
    if (update.speechLikePacketCount !== undefined) {
      session.speechLikePacketCount = update.speechLikePacketCount;
    }
    if (update.silencePacketCount !== undefined) {
      session.silencePacketCount = update.silencePacketCount;
    }
    if (update.ignoredNoisePacketCount !== undefined) {
      session.ignoredNoisePacketCount = update.ignoredNoisePacketCount;
    }
    if (update.ignoredSpeechPacketCount !== undefined) {
      session.ignoredSpeechPacketCount = update.ignoredSpeechPacketCount;
    }
    if (update.detectedCustomerLanguage !== undefined) {
      session.detectedCustomerLanguage = update.detectedCustomerLanguage;
    }
    if (update.lastCustomerLanguage !== undefined) {
      session.lastCustomerLanguage = update.lastCustomerLanguage;
    }
    if (update.responseLanguage !== undefined) {
      session.responseLanguage = update.responseLanguage;
    }
    if (update.languageMatchMode !== undefined) {
      session.languageMatchMode = update.languageMatchMode;
    }
    if (update.firstCustomerSpeechAt !== undefined) {
      session.firstCustomerSpeechAt = update.firstCustomerSpeechAt;
    }
    if (update.firstResponseCreateAt !== undefined) {
      session.firstResponseCreateAt = update.firstResponseCreateAt;
    }
    if (update.startupListenDelayMs !== undefined) {
      session.startupListenDelayMs = update.startupListenDelayMs;
    }
    if (update.autoReplyBlockedCount !== undefined) {
      session.autoReplyBlockedCount = update.autoReplyBlockedCount;
    }
    if (update.responseBlockedReason !== undefined) {
      session.responseBlockedReason = update.responseBlockedReason;
    }
    if (update.isOpenAiConnected !== undefined) {
      session.isOpenAiConnected = update.isOpenAiConnected;
    }
    if (update.hasReceivedCallerAudio !== undefined) {
      session.hasReceivedCallerAudio = update.hasReceivedCallerAudio;
    }
    if (update.lastCallerAudioAt !== undefined) {
      session.lastCallerAudioAt = update.lastCallerAudioAt;
    }
    if (update.lastMediaAt !== undefined) {
      session.lastMediaAt = update.lastMediaAt;
    }
    if (update.lastSpeechLikeAudioAt !== undefined) {
      session.lastSpeechLikeAudioAt = update.lastSpeechLikeAudioAt;
    }
    if (update.lastOpenAiAppendAt !== undefined) {
      session.lastOpenAiAppendAt = update.lastOpenAiAppendAt;
    }
    if (update.lastSpeechStartedAt !== undefined) {
      session.lastSpeechStartedAt = update.lastSpeechStartedAt;
    }
    if (update.lastSpeechStoppedAt !== undefined) {
      session.lastSpeechStoppedAt = update.lastSpeechStoppedAt;
    }
    if (update.lastCommitAt !== undefined) {
      session.lastCommitAt = update.lastCommitAt;
    }
    if (update.lastResponseCreateAt !== undefined) {
      session.lastResponseCreateAt = update.lastResponseCreateAt;
    }
    if (update.lastResponseDoneAt !== undefined) {
      session.lastResponseDoneAt = update.lastResponseDoneAt;
    }
    if (update.lastOpenAiAudioDoneAt !== undefined) {
      session.lastOpenAiAudioDoneAt = update.lastOpenAiAudioDoneAt;
    }
    if (update.lastOpenAiEvent !== undefined) {
      session.lastOpenAiEvent = update.lastOpenAiEvent;
    }
    if (update.lastError !== undefined) {
      session.lastError = update.lastError;
    }
    if (update.responsePending !== undefined) {
      session.responsePending = update.responsePending;
    }
    if (update.isAwaitingOpenAiResponse !== undefined) {
      session.isAwaitingOpenAiResponse = update.isAwaitingOpenAiResponse;
    }
    if (update.isAiSpeaking !== undefined) {
      session.isAiSpeaking = update.isAiSpeaking;
    }
    if (update.lastOpenAiAudioAt !== undefined) {
      session.lastOpenAiAudioAt = update.lastOpenAiAudioAt;
    }
    if (update.responseCount !== undefined) {
      session.responseCount = update.responseCount;
    }
    if (update.responseCreateCount !== undefined) {
      session.responseCreateCount = update.responseCreateCount;
    }
    if (update.responseDoneCount !== undefined) {
      session.responseDoneCount = update.responseDoneCount;
    }
    if (update.appendCount !== undefined) {
      session.appendCount = update.appendCount;
    }
    if (update.commitCount !== undefined) {
      session.commitCount = update.commitCount;
    }
    if (update.outboundMediaCount !== undefined) {
      session.outboundMediaCount = update.outboundMediaCount;
    }
    if (update.outboundBufferedBytes !== undefined) {
      session.outboundBufferedBytes = update.outboundBufferedBytes;
    }
    if (update.outboundFinalFlushAt !== undefined) {
      session.outboundFinalFlushAt = update.outboundFinalFlushAt;
    }
    if (update.manualFallbackCommitCount !== undefined) {
      session.manualFallbackCommitCount = update.manualFallbackCommitCount;
    }
    if (update.callEndDetected !== undefined) {
      session.callEndDetected = update.callEndDetected;
    }
    if (update.callEndReason !== undefined) {
      session.callEndReason = update.callEndReason;
    }
    if (update.callEndScheduledAt !== undefined) {
      session.callEndScheduledAt = update.callEndScheduledAt;
    }
    if (update.callEndCloseAt !== undefined) {
      session.callEndCloseAt = update.callEndCloseAt;
    }
    if (update.callEndCloseError !== undefined) {
      session.callEndCloseError = update.callEndCloseError;
    }
    if (update.incrementSpeechLikeFrame) {
      session.speechLikeFrameCount = (session.speechLikeFrameCount ?? 0) + 1;
    }
    if (update.incrementSilenceFrame) {
      session.silenceFrameCount = (session.silenceFrameCount ?? 0) + 1;
    }
    if (update.openAiEventCounts !== undefined) {
      session.openAiEventCounts = update.openAiEventCounts;
    }
    if (update.incrementOpenAiEvent) {
      const counts = session.openAiEventCounts ?? {};
      counts[update.incrementOpenAiEvent] =
        (counts[update.incrementOpenAiEvent] ?? 0) + 1;
      session.openAiEventCounts = counts;
    }
  }

  recordInboundAudioStats(streamSid: string, chunk: Pcm16Stats): void {
    const merged = mergePcm16Stats(
      this.inboundStatsByStreamSid.get(streamSid),
      chunk,
    );
    this.inboundStatsByStreamSid.set(streamSid, merged);
    this.applyAudioStatsToSession(streamSid, 'inbound', merged);
  }

  recordOutboundAudioStats(streamSid: string, chunk: Pcm16Stats): void {
    const merged = mergePcm16Stats(
      this.outboundStatsByStreamSid.get(streamSid),
      chunk,
    );
    this.outboundStatsByStreamSid.set(streamSid, merged);
    this.applyAudioStatsToSession(streamSid, 'outbound', merged);
  }

  setAudioGainApplied(streamSid: string, gain: number): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }
    session.audioGainApplied = gain;
  }

  recordSmartfloOutboundSend(
    streamSid: string,
    bytes: number,
    wsReadyState: number,
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    const now = new Date();
    session.outboundBytesSent = (session.outboundBytesSent ?? 0) + bytes;
    session.outboundFirstSentAt ??= now;
    session.outboundLastSentAt = now;
    session.lastSmartfloSendAt = now;
    session.smartfloWsReadyState = wsReadyState;

    session.outboundChunkMinBytes =
      session.outboundChunkMinBytes == null
        ? bytes
        : Math.min(session.outboundChunkMinBytes, bytes);
    session.outboundChunkMaxBytes =
      session.outboundChunkMaxBytes == null
        ? bytes
        : Math.max(session.outboundChunkMaxBytes, bytes);
    session.outboundChunkTotalBytes =
      (session.outboundChunkTotalBytes ?? 0) + bytes;
    session.outboundChunkSendCount = (session.outboundChunkSendCount ?? 0) + 1;
  }

  recordSmartfloSendFailure(streamSid: string, wsReadyState: number): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    session.smartfloWsReadyState = wsReadyState;
    session.smartfloSendErrors = (session.smartfloSendErrors ?? 0) + 1;
  }

  private applyAudioStatsToSession(
    streamSid: string,
    direction: 'inbound' | 'outbound',
    stats: Pcm16Stats,
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    if (direction === 'inbound') {
      session.inboundPeakAmplitude = stats.peak;
      session.inboundAvgAmplitude = Number(stats.avgAbs.toFixed(2));
      session.inboundRms = Number(stats.rms.toFixed(2));
      return;
    }

    session.outboundPeakAmplitude = stats.peak;
    session.outboundAvgAmplitude = Number(stats.avgAbs.toFixed(2));
    session.outboundRms = Number(stats.rms.toFixed(2));
  }

  attachRecordingMetadata(
    streamSid: string,
    metadata: {
      fileName: string;
      durationMsEstimate: number;
      mulawBytes: number;
      wavBytes: number;
      inboundTimelineStartMs?: number | null;
      inboundTimelineEndMs?: number | null;
      outboundTimelineStartMs?: number | null;
      outboundTimelineEndMs?: number | null;
      inboundChunkCount?: number;
      outboundChunkCount?: number;
    },
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    session.recordingAvailable = true;
    session.recordingFileName = metadata.fileName;
    session.recordingDurationMsEstimate = metadata.durationMsEstimate;
    session.recordingMulawBytes = metadata.mulawBytes;
    session.recordingWavBytes = metadata.wavBytes;
    session.recordingInboundTimelineStartMs = metadata.inboundTimelineStartMs ?? null;
    session.recordingInboundTimelineEndMs = metadata.inboundTimelineEndMs ?? null;
    session.recordingOutboundTimelineStartMs = metadata.outboundTimelineStartMs ?? null;
    session.recordingOutboundTimelineEndMs = metadata.outboundTimelineEndMs ?? null;
    session.recordingInboundChunkCount = metadata.inboundChunkCount;
    session.recordingOutboundChunkCount = metadata.outboundChunkCount;
  }

  endByStreamSid(streamSid: string, stopReason?: string | null): void {
    const session = this.activeByStreamSid.get(streamSid);
    if (!session || session.status === 'ENDED') {
      return;
    }

    if (session.isAppInitiated !== true) {
      this.discardSession(session, stopReason ?? null, 'stop');
      return;
    }

    this.endSession(session, stopReason ?? null, 'stop');
  }

  endBySocketSessionId(socketSessionId: string): void {
    const session = this.activeBySocketSessionId.get(socketSessionId);
    if (!session || session.status === 'ENDED') {
      return;
    }

    if (session.isAppInitiated !== true) {
      this.discardSession(session, 'websocket_disconnected', 'disconnect');
      return;
    }

    this.endSession(session, 'websocket_disconnected', 'disconnect');
  }

  private discardSession(
    session: VoiceSession,
    stopReason: string | null,
    lastEvent: string,
  ): void {
    session.status = 'ENDED';
    session.endedAt = new Date();
    session.stopReason = stopReason;
    session.lastEvent = lastEvent;
    session.lastEventAt = new Date();

    this.activeBySocketSessionId.delete(session.socketSessionId);
    if (session.streamSid) {
      this.activeByStreamSid.delete(session.streamSid);
      this.socketToStreamSid.delete(session.socketSessionId);
      this.inboundStatsByStreamSid.delete(session.streamSid);
      this.outboundStatsByStreamSid.delete(session.streamSid);
    }
  }

  private endSession(
    session: VoiceSession,
    stopReason: string | null,
    lastEvent: string,
  ): void {
    session.status = 'ENDED';
    session.endedAt = new Date();
    session.stopReason = stopReason;
    session.lastEvent = lastEvent;
    session.lastEventAt = new Date();

    this.activeBySocketSessionId.delete(session.socketSessionId);
    if (session.streamSid) {
      this.activeByStreamSid.delete(session.streamSid);
      this.socketToStreamSid.delete(session.socketSessionId);
      this.inboundStatsByStreamSid.delete(session.streamSid);
      this.outboundStatsByStreamSid.delete(session.streamSid);
    }

    this.recentEndedSessions.push(session);
    if (session.streamSid) {
      this.recentEndedByStreamSid.set(session.streamSid, session);
    }

    while (this.recentEndedSessions.length > MAX_RECENT_ENDED_SESSIONS) {
      const oldest = this.recentEndedSessions.shift();
      if (oldest?.streamSid) {
        this.recentEndedByStreamSid.delete(oldest.streamSid);
      }
    }

    void this.voiceSharedStateService.saveEndedSession(
      toVoiceSessionResponse(session),
    );
  }
}
