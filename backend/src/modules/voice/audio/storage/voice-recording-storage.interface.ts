import { Readable } from 'node:stream';

export const VOICE_RECORDINGS_STORAGE_PREFIX = 'voice-recordings';

export interface VoiceRecordingStorageWriteOptions {
  contentType: string;
}

export interface VoiceRecordingStorage {
  write(
    storageKey: string,
    data: Buffer,
    options: VoiceRecordingStorageWriteOptions,
  ): Promise<void>;

  exists(storageKey: string): Promise<boolean>;

  createReadStream(storageKey: string): Readable;
}

export function buildVoiceRecordingStorageKey(fileName: string): string {
  return `${VOICE_RECORDINGS_STORAGE_PREFIX}/${fileName}`;
}

export function toSafeRecordingFileName(streamSid: string): string {
  const sanitized = streamSid.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized.length > 0 ? `${sanitized}.wav` : 'recording.wav';
}
