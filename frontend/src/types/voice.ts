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

export interface VoiceTestCallRequest {
  customerNumber: string;
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

export function voiceRecordingDownloadUrl(streamSid: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  return `${base}/voice/recordings/${encodeURIComponent(streamSid)}/download`;
}
