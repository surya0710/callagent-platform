import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  decodeMulawBuffer,
  decodeMulawSample,
  encodePcm16ToMulaw,
} from './mulaw-codec';
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

interface TimelineChunk {
  offsetMs: number;
  mulaw: Buffer;
}

interface ActiveRecording {
  streamSid: string;
  callSid?: string;
  streamStartedAtMs: number;
  outboundCursorMs: number | null;
  inboundChunks: TimelineChunk[];
  outboundChunks: TimelineChunk[];
}

const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const MULAW_SILENCE_BYTE = 0xff;
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
      streamStartedAtMs: Date.now(),
      outboundCursorMs: null,
      inboundChunks: [],
      outboundChunks: [],
    });
  }

  appendInboundMulawBase64(
    streamSid: string,
    base64Payload: string,
    offsetMs?: number,
  ): void {
    this.appendTimelineMulawBase64(
      streamSid,
      base64Payload,
      'inbound',
      offsetMs,
    );
  }

  /** @deprecated Use appendInboundMulawBase64 */
  appendMulawBase64(streamSid: string, base64Payload: string): void {
    this.appendInboundMulawBase64(streamSid, base64Payload);
  }

  appendOutboundMulawBase64(
    streamSid: string,
    base64Payload: string,
    offsetMs?: number,
  ): void {
    this.appendTimelineMulawBase64(
      streamSid,
      base64Payload,
      'outbound',
      offsetMs,
    );
  }

  private appendTimelineMulawBase64(
    streamSid: string,
    base64Payload: string,
    direction: 'inbound' | 'outbound',
    offsetMs?: number,
  ): void {
    if (!streamSid) {
      return;
    }

    const active = this.activeByStreamSid.get(streamSid);
    if (!active) {
      return;
    }

    try {
      const mulaw = Buffer.from(base64Payload, 'base64');
      if (mulaw.length === 0) {
        this.logger.warn({
          streamSid,
          direction,
          message: 'Skipping empty media payload after base64 decode',
        });
        return;
      }

      const chunkDurationMs = (mulaw.length / SAMPLE_RATE) * 1000;
      let resolvedOffsetMs = offsetMs;

      if (direction === 'outbound') {
        if (resolvedOffsetMs == null) {
          if (active.outboundCursorMs == null) {
            active.outboundCursorMs = Date.now() - active.streamStartedAtMs;
          }
          resolvedOffsetMs = active.outboundCursorMs;
          active.outboundCursorMs += chunkDurationMs;
        }
      } else if (resolvedOffsetMs == null) {
        resolvedOffsetMs = Date.now() - active.streamStartedAtMs;
      }

      const timelineChunk: TimelineChunk = {
        offsetMs: Math.max(0, resolvedOffsetMs),
        mulaw,
      };

      if (direction === 'inbound') {
        active.inboundChunks.push(timelineChunk);
      } else {
        active.outboundChunks.push(timelineChunk);
      }
    } catch (error) {
      this.logger.warn({
        streamSid,
        direction,
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

    if (active.inboundChunks.length === 0 && active.outboundChunks.length === 0) {
      return null;
    }

    try {
      const mulawBuffer = buildMixedMulawTimeline(
        active.inboundChunks,
        active.outboundChunks,
      );
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
        chunks: active.inboundChunks.length + active.outboundChunks.length,
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
        inboundChunks: active.inboundChunks.length,
        outboundChunks: active.outboundChunks.length,
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

function buildMixedMulawTimeline(
  inboundChunks: TimelineChunk[],
  outboundChunks: TimelineChunk[],
): Buffer {
  const allChunks = [...inboundChunks, ...outboundChunks];
  if (allChunks.length === 0) {
    return Buffer.alloc(0);
  }

  const totalMs = allChunks.reduce((maxEndMs, chunk) => {
    const endMs = chunk.offsetMs + (chunk.mulaw.length / SAMPLE_RATE) * 1000;
    return Math.max(maxEndMs, endMs);
  }, 0);
  const totalSamples = Math.max(1, Math.ceil((totalMs / 1000) * SAMPLE_RATE));
  const output = Buffer.alloc(totalSamples, MULAW_SILENCE_BYTE);

  for (const chunk of allChunks) {
    const startSample = Math.floor((chunk.offsetMs / 1000) * SAMPLE_RATE);
    for (let i = 0; i < chunk.mulaw.length; i += 1) {
      const position = startSample + i;
      if (position >= output.length) {
        break;
      }

      const incoming = chunk.mulaw[i]!;
      if (incoming === MULAW_SILENCE_BYTE) {
        continue;
      }

      const existing = output[position]!;
      output[position] =
        existing === MULAW_SILENCE_BYTE
          ? incoming
          : mixMulawBytes(existing, incoming);
    }
  }

  return output;
}

function mixMulawBytes(existing: number, incoming: number): number {
  const pcmA = decodeMulawSample(existing);
  const pcmB = decodeMulawSample(incoming);
  const mixed = Math.max(-32768, Math.min(32767, Math.round((pcmA + pcmB) / 2)));
  const mixedPcm = Buffer.alloc(2);
  mixedPcm.writeInt16LE(mixed, 0);
  return encodePcm16ToMulaw(mixedPcm)[0]!;
}
