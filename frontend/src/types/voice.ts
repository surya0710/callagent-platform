export type VoiceSessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED';

export interface VoiceMediaFormat {
  encoding?: string;
  sampleRate?: number;
  bitRate?: number;
  bitDepth?: number;
}

export interface VoiceSession {
  socketSessionId: string;
  streamSid?: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: VoiceMediaFormat;
  customParameters?: Record<string, unknown>;
  status: VoiceSessionStatus;
  isAppInitiated?: boolean;
  isOpenAiConnected?: boolean;
  rejectionReason?: string;
  connectedAt?: string;
  startedAt?: string;
  endedAt?: string | null;
  lastEvent?: string;
  lastEventAt?: string;
  packetsReceived: number;
  lastMediaChunk?: string;
  lastMediaTimestamp?: string;
  lastMediaPayloadLength?: number;
  dtmfDigits?: string[];
  marksReceived?: string[];
  stopReason?: string | null;
  remoteAddress?: string;
  recordingAvailable?: boolean;
  recordingS3Url?: string | null;
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
  telephonyProvider?: string;
  streamSidIsFallback?: boolean;
  authorizationSource?: string;
  authorizationId?: string;
  runtimeStatus?: 'idle' | 'connecting' | 'connected' | 'error' | 'closed';
  runtimeConnectedAt?: string;
  runtimeLastEventAt?: string;
  runtimeError?: string;
  callId?: string;
  transcriptMode?: string;
  realtimeTranscriptCount?: number;
  finalTranscriptStatus?: 'none' | 'draft' | 'processing' | 'final' | 'failed';
  transcriptError?: string;
  transcriptLanguageDetected?: 'hi' | 'en' | 'mixed' | 'unknown';
}

export type VoiceTranscriptLifecycleStatus =
  | 'none'
  | 'draft'
  | 'processing'
  | 'final'
  | 'failed';

export interface VoiceTranscriptSegment {
  speaker: 'customer' | 'assistant' | 'unknown';
  text: string;
  startedAtMs?: number;
  endedAtMs?: number;
  source: 'realtime' | 'postcall';
  status: 'draft' | 'final';
  language?: string;
  confidence?: number;
}

export interface VoiceTranscriptResponse {
  streamSid?: string;
  callId?: string;
  transcriptStatus: VoiceTranscriptLifecycleStatus;
  transcriptMode?: string;
  transcriptLanguageDetected?: string;
  transcriptError?: string;
  realtimeTranscriptCount?: number;
  content?: string;
  transcript: VoiceTranscriptSegment[];
}

export type TranscriptEmailStatus =
  | 'not_sent'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'skipped';

export interface TranscriptEmailStatusResponse {
  status: TranscriptEmailStatus;
  callId?: string | null;
  streamSid?: string | null;
  sentAt?: string | null;
  reason?: string | null;
  error?: string | null;
  recipients?: {
    to: string[];
    cc: string[];
  };
}

export interface VoiceSessionsResponse {
  active: VoiceSession[];
  recentEnded: VoiceSession[];
}

export interface VoiceServerOrigin {
  hostname: string;
  serverId: string | null;
  environment: string | null;
  appVersion: string | null;
  smartfloApiBaseUrl: string;
  voiceWssBaseUrl: string;
}

export interface VoiceCallRequestOrigin extends VoiceServerOrigin {
  smartfloRequestUrl: string;
  requestedByIp?: string;
  requestedByForwardedFor?: string;
}

export interface VoiceHealthResponse {
  success: boolean;
  service: string;
  activeSessions: number;
  recentEndedSessions: number;
  voiceRequireAppAuthorization?: boolean;
  timestamp: string;
  serverOrigin?: VoiceServerOrigin;
}

export interface VoiceCallContext {
  bookingNumber?: string;
  customerName?: string;
  customerNumber?: string;
  driverName?: string;
  driverMobileNumber?: string;
  totalCharges?: number;
  balanceAmount?: number;
  paymentMode?: string;
}

export interface VoiceTestCallRequest {
  customerNumber: string;
  callContext?: VoiceCallContext;
}

export interface VoiceTestCallResponse {
  success: boolean;
  message: string;
  providerResponse: unknown;
  requestedCustomerNumber: string;
  normalizedCustomerNumber: string;
  callOrigin: VoiceCallRequestOrigin;
  authorizationId?: string;
  providerCallSid?: string | null;
}

export interface VoiceSignedRecordingUrlResponse {
  streamSid: string;
  s3Key: string;
  expiresInSeconds: number;
  url: string;
}

export function voiceRecordingDownloadUrl(streamSid: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  return `${base}/voice/recordings/${encodeURIComponent(streamSid)}/download`;
}
