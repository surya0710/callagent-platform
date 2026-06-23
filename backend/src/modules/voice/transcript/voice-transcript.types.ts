export type TranscriptSpeaker = 'customer' | 'assistant' | 'unknown';
export type TranscriptSource = 'realtime' | 'postcall';
export type TranscriptSegmentStatus = 'draft' | 'final';
export type TranscriptLanguage = 'hi' | 'en' | 'mixed' | 'unknown';
export type TranscriptLifecycleStatus =
  | 'none'
  | 'draft'
  | 'processing'
  | 'final'
  | 'failed';

export type VoiceTranscriptMode = 'realtime' | 'postcall' | 'realtime_and_postcall';

export interface VoiceTranscriptSegmentDto {
  speaker: TranscriptSpeaker;
  text: string;
  startedAtMs?: number;
  endedAtMs?: number;
  source: TranscriptSource;
  status: TranscriptSegmentStatus;
  language?: TranscriptLanguage;
  confidence?: number;
}

export interface VoiceTranscriptResponseDto {
  streamSid?: string;
  callId?: string;
  transcriptStatus: TranscriptLifecycleStatus;
  transcriptMode?: VoiceTranscriptMode;
  transcriptLanguageDetected?: TranscriptLanguage;
  transcriptError?: string;
  realtimeTranscriptCount?: number;
  transcript: VoiceTranscriptSegmentDto[];
  content?: string;
}

export interface RealtimeTranscriptDeltaInput {
  streamSid: string;
  callId?: string;
  speaker: TranscriptSpeaker;
  delta: string;
  itemId?: string;
}

export interface RealtimeTranscriptCompletedInput {
  streamSid: string;
  callId?: string;
  speaker: TranscriptSpeaker;
  text: string;
  startedAtMs?: number;
  endedAtMs?: number;
  language?: TranscriptLanguage;
  confidence?: number;
  itemId?: string;
}

export interface PostCallTranscriptJobPayload {
  callId: string;
  streamSid: string;
  mixedStorageKey: string;
  inboundStorageKey?: string;
  outboundStorageKey?: string;
  durationMsEstimate?: number;
}

export interface SendTranscriptEmailJobPayload {
  callId?: string;
  streamSid?: string;
  logId?: string;
  resend?: boolean;
  trigger?: 'auto' | 'manual';
}
