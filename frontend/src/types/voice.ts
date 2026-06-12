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
  runtimeProvider?: string;
  runtimeStatus?: 'idle' | 'connecting' | 'connected' | 'error' | 'closed';
  runtimeConnectedAt?: string;
  runtimeLastEventAt?: string;
  runtimeError?: string;
}

export interface VoiceSessionsResponse {
  active: VoiceSession[];
  recentEnded: VoiceSession[];
}

export interface VoiceHealthResponse {
  success: boolean;
  service: string;
  activeSessions: number;
  recentEndedSessions: number;
  timestamp: string;
}

export function voiceRecordingDownloadUrl(streamSid: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  return `${base}/voice/recordings/${encodeURIComponent(streamSid)}/download`;
}
