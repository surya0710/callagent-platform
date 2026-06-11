import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { decodeMulawBuffer } from './mulaw-codec';
import {
  buildVoiceRecordingStorageKey,
  toSafeRecordingFileName,
} from './storage/voice-recording-storage.interface';
import { VoiceRecordingStorageFactory } from './storage/voice-recording-storage.factory';
import { createWavBuffer } from './wav-writer';

export interface VoiceRecordingMetadata {
  streamSid: string;
  callSid?: string;
  fileName: string;
  storageKey: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  mulawBytes: number;
  pcmBytes: number;
  wavBytes: number;
  chunks: number;
  durationMsEstimate: number;
  createdAt: string;
}

export type VoiceRecordingPublicMetadata = Omit<
  VoiceRecordingMetadata,
  'storageKey'
>;

interface ActiveRecording {
  streamSid: string;
  callSid?: string;
  chunks: Buffer[];
}

const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const MAX_METADATA_ENTRIES = 100;

@Injectable()
export class VoiceRecordingService {
  private readonly logger = new Logger(VoiceRecordingService.name);
  private readonly activeByStreamSid = new Map<string, ActiveRecording>();
  private readonly finalizedByStreamSid = new Map<
    string,
    VoiceRecordingMetadata
  >();

  constructor(
    private readonly storageFactory: VoiceRecordingStorageFactory,
  ) {}

  start(streamSid: string, callSid?: string): void {
    if (!streamSid) {
      return;
    }

    if (this.finalizedByStreamSid.has(streamSid)) {
      return;
    }

    const existing = this.activeByStreamSid.get(streamSid);
    if (existing) {
      if (callSid && !existing.callSid) {
        existing.callSid = callSid;
      }
      return;
    }

    this.activeByStreamSid.set(streamSid, {
      streamSid,
      callSid,
      chunks: [],
    });
  }

  appendMulawBase64(streamSid: string, base64Payload: string): void {
    if (!streamSid) {
      return;
    }

    const active = this.activeByStreamSid.get(streamSid);
    if (!active) {
      return;
    }

    try {
      const chunk = Buffer.from(base64Payload, 'base64');
      if (chunk.length === 0) {
        this.logger.warn({
          streamSid,
          message: 'Skipping empty media payload after base64 decode',
        });
        return;
      }
      active.chunks.push(chunk);
    } catch (error) {
      this.logger.warn({
        streamSid,
        err: error,
        message: 'Invalid base64 media payload; skipping chunk',
      });
    }
  }

  async finalize(
    streamSid: string,
    callSid?: string,
  ): Promise<VoiceRecordingMetadata | null> {
    if (!streamSid) {
      return null;
    }

    const existing = this.finalizedByStreamSid.get(streamSid);
    if (existing) {
      return existing;
    }

    const active = this.activeByStreamSid.get(streamSid);
    if (!active) {
      return null;
    }

    this.activeByStreamSid.delete(streamSid);

    if (active.chunks.length === 0) {
      return null;
    }

    try {
      const mulawBuffer = Buffer.concat(active.chunks);
      const pcmBuffer = decodeMulawBuffer(mulawBuffer);
      const wavBuffer = createWavBuffer(pcmBuffer, {
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
      });

      const fileName = toSafeRecordingFileName(streamSid);
      const storageKey = buildVoiceRecordingStorageKey(fileName);
      const storage = this.storageFactory.getStorage();

      await storage.write(storageKey, wavBuffer, {
        contentType: 'audio/wav',
      });

      const metadata: VoiceRecordingMetadata = {
        streamSid,
        callSid: callSid ?? active.callSid,
        fileName,
        storageKey,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        mulawBytes: mulawBuffer.length,
        pcmBytes: pcmBuffer.length,
        wavBytes: wavBuffer.length,
        chunks: active.chunks.length,
        durationMsEstimate: Math.round((mulawBuffer.length / SAMPLE_RATE) * 1000),
        createdAt: new Date().toISOString(),
      };

      this.finalizedByStreamSid.set(streamSid, metadata);
      this.trimMetadataEntries();

      this.logger.log({
        streamSid,
        fileName,
        storageKey,
        mulawBytes: metadata.mulawBytes,
        wavBytes: metadata.wavBytes,
        chunks: metadata.chunks,
        message: 'Voice recording finalized',
      });

      return metadata;
    } catch (error) {
      this.logger.error(
        { streamSid, err: error },
        'Failed to finalize voice recording',
      );
      return null;
    }
  }

  getRecording(streamSid: string): VoiceRecordingMetadata | undefined {
    return this.finalizedByStreamSid.get(streamSid);
  }

  listRecordings(): VoiceRecordingMetadata[] {
    return Array.from(this.finalizedByStreamSid.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  getRecordingStorageKey(streamSid: string): string | undefined {
    return this.finalizedByStreamSid.get(streamSid)?.storageKey;
  }

  clearOldRecordings(maxCount = MAX_METADATA_ENTRIES): void {
    const recordings = this.listRecordings();
    if (recordings.length <= maxCount) {
      return;
    }

    const toRemove = recordings.slice(maxCount);
    for (const recording of toRemove) {
      this.finalizedByStreamSid.delete(recording.streamSid);
    }
  }

  toPublicMetadata(
    metadata: VoiceRecordingMetadata,
  ): VoiceRecordingPublicMetadata {
    const { storageKey: _storageKey, ...publicMetadata } = metadata;
    return publicMetadata;
  }

  async recordingExists(streamSid: string): Promise<boolean> {
    const storageKey = this.getRecordingStorageKey(streamSid);
    if (!storageKey) {
      return false;
    }

    return this.storageFactory.getStorage().exists(storageKey);
  }

  openRecordingReadStream(streamSid: string): Readable | null {
    const storageKey = this.getRecordingStorageKey(streamSid);
    if (!storageKey) {
      return null;
    }

    return this.storageFactory.getStorage().createReadStream(storageKey);
  }

  private trimMetadataEntries(): void {
    this.clearOldRecordings(MAX_METADATA_ENTRIES);
  }
}
