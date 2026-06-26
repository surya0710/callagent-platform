import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  analyzePcm16,
  formatPcm16Stats,
} from './pcm-stats.util';
import {
  buildMixedPcmTimeline,
  buildTrackPcmTimeline,
  summarizeRecordingTimeline,
} from './pcm-recording-mix.util';
import { VoiceSessionService } from '../voice-session.service';
import { toSafeRecordingFileName } from './storage/voice-recording-storage.interface';
import { S3RecordingStorageService } from './s3-recording-storage.service';
import { createWavBuffer } from './wav-writer';
import { PrismaService } from '../../../database/prisma.service';

export interface VoiceRecordingMetadata {
  streamSid: string;
  callSid?: string;
  fileName: string;
  storageKey: string;
  /** S3 object key (legacy field name; not a public HTTP URL). */
  recordingS3Url?: string;
  inboundStorageKey?: string;
  outboundStorageKey?: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  mulawBytes: number;
  pcmBytes: number;
  wavBytes: number;
  chunks: number;
  durationMsEstimate: number;
  createdAt: string;
  inboundTimelineStartMs?: number | null;
  inboundTimelineEndMs?: number | null;
  outboundTimelineStartMs?: number | null;
  outboundTimelineEndMs?: number | null;
  inboundChunkCount?: number;
  outboundChunkCount?: number;
  s3Enabled?: boolean;
  s3Bucket?: string;
  s3Key?: string;
  s3UploadedAt?: string;
  s3UploadError?: string;
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
  inboundCursorMs: number | null;
  outboundCursorMs: number | null;
  inboundChunks: TimelineChunk[];
  outboundChunks: TimelineChunk[];
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
    private readonly voiceSessionService: VoiceSessionService,
    private readonly s3RecordingStorageService: S3RecordingStorageService,
    private readonly prisma: PrismaService,
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
      inboundCursorMs: null,
      outboundCursorMs: null,
      inboundChunks: [],
      outboundChunks: [],
    });
  }

  appendInboundMulawBase64(streamSid: string, base64Payload: string): void {
    this.appendTimelineMulawBase64(streamSid, base64Payload, 'inbound');
  }

  /** @deprecated Use appendInboundMulawBase64 */
  appendMulawBase64(streamSid: string, base64Payload: string): void {
    this.appendInboundMulawBase64(streamSid, base64Payload);
  }

  appendOutboundMulawBase64(streamSid: string, base64Payload: string): void {
    this.appendTimelineMulawBase64(streamSid, base64Payload, 'outbound');
  }

  private appendTimelineMulawBase64(
    streamSid: string,
    base64Payload: string,
    direction: 'inbound' | 'outbound',
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
      const resolvedOffsetMs = this.resolveRecordingOffsetMs(
        active,
        direction,
        chunkDurationMs,
      );

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

  /**
   * Live-call recording timeline: wall-clock ms from Smartflo `start`, with a
   * per-direction cursor so burst chunks stay sequential on the same clock.
   */
  private resolveRecordingOffsetMs(
    active: ActiveRecording,
    direction: 'inbound' | 'outbound',
    chunkDurationMs: number,
  ): number {
    const wallOffsetMs = Math.max(0, Date.now() - active.streamStartedAtMs);
    const cursor =
      direction === 'inbound'
        ? active.inboundCursorMs
        : active.outboundCursorMs;
    const resolvedMs = cursor == null ? wallOffsetMs : Math.max(wallOffsetMs, cursor);

    if (direction === 'inbound') {
      active.inboundCursorMs = resolvedMs + chunkDurationMs;
    } else {
      active.outboundCursorMs = resolvedMs + chunkDurationMs;
    }

    return resolvedMs;
  }

  async finalize(
    streamSid: string,
    callSid?: string,
    options?: { includeSpeakerTracks?: boolean; callId?: string },
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
      const inboundTimeline = summarizeRecordingTimeline(
        active.inboundChunks,
        SAMPLE_RATE,
      );
      const outboundTimeline = summarizeRecordingTimeline(
        active.outboundChunks,
        SAMPLE_RATE,
      );

      const pcmBuffer = buildMixedPcmTimeline(
        active.inboundChunks,
        active.outboundChunks,
        SAMPLE_RATE,
      );
      const pcmStats = analyzePcm16(pcmBuffer);
      this.voiceSessionService.setAudioGainApplied(streamSid, 1);

      const wavBuffer = createWavBuffer(pcmBuffer, {
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
      });

      const resolvedCallSid = callSid ?? active.callSid;
      const mixedUpload = await this.s3RecordingStorageService.uploadRecording(
        wavBuffer,
        streamSid,
        resolvedCallSid,
        'mixed',
      );

      if (!mixedUpload || 'error' in mixedUpload) {
        this.logger.error({
          streamSid,
          err: mixedUpload && 'error' in mixedUpload ? mixedUpload.error : 'unknown',
          message: 'Failed to upload mixed recording to S3',
        });
        return null;
      }

      let inboundStorageKey: string | undefined;
      let outboundStorageKey: string | undefined;

      if (options?.includeSpeakerTracks) {
        if (active.inboundChunks.length > 0) {
          const inboundPcm = buildTrackPcmTimeline(
            active.inboundChunks,
            SAMPLE_RATE,
            'inbound',
          );
          if (inboundPcm.length > 0) {
            const inboundUpload =
              await this.s3RecordingStorageService.uploadRecording(
                createWavBuffer(inboundPcm, {
                  sampleRate: SAMPLE_RATE,
                  channels: CHANNELS,
                  bitsPerSample: BITS_PER_SAMPLE,
                }),
                streamSid,
                resolvedCallSid,
                'inbound',
              );
            if (inboundUpload && !('error' in inboundUpload)) {
              inboundStorageKey = inboundUpload.key;
            }
          }
        }

        if (active.outboundChunks.length > 0) {
          const outboundPcm = buildTrackPcmTimeline(
            active.outboundChunks,
            SAMPLE_RATE,
            'outbound',
          );
          if (outboundPcm.length > 0) {
            const outboundUpload =
              await this.s3RecordingStorageService.uploadRecording(
                createWavBuffer(outboundPcm, {
                  sampleRate: SAMPLE_RATE,
                  channels: CHANNELS,
                  bitsPerSample: BITS_PER_SAMPLE,
                }),
                streamSid,
                resolvedCallSid,
                'outbound',
              );
            if (outboundUpload && !('error' in outboundUpload)) {
              outboundStorageKey = outboundUpload.key;
            }
          }
        }
      }

      const fileName = toSafeRecordingFileName(streamSid);

      if (options?.callId) {
        await this.saveS3KeyToDb(
          options.callId,
          mixedUpload.key,
          streamSid,
        );
      }

      const metadata: VoiceRecordingMetadata = {
        streamSid,
        callSid: resolvedCallSid,
        fileName,
        storageKey: mixedUpload.key,
        recordingS3Url: mixedUpload.key,
        inboundStorageKey,
        outboundStorageKey,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        mulawBytes: active.inboundChunks.reduce((sum, c) => sum + c.mulaw.length, 0) +
          active.outboundChunks.reduce((sum, c) => sum + c.mulaw.length, 0),
        pcmBytes: pcmBuffer.length,
        wavBytes: wavBuffer.length,
        chunks: active.inboundChunks.length + active.outboundChunks.length,
        durationMsEstimate: Math.round((pcmBuffer.length / 2 / SAMPLE_RATE) * 1000),
        createdAt: new Date().toISOString(),
        inboundTimelineStartMs: inboundTimeline.startMs,
        inboundTimelineEndMs: inboundTimeline.endMs,
        outboundTimelineStartMs: outboundTimeline.startMs,
        outboundTimelineEndMs: outboundTimeline.endMs,
        inboundChunkCount: inboundTimeline.chunkCount,
        outboundChunkCount: outboundTimeline.chunkCount,
        s3Enabled: true,
        s3Bucket: mixedUpload.bucket,
        s3Key: mixedUpload.key,
        s3UploadedAt: mixedUpload.uploadedAt,
      };

      this.finalizedByStreamSid.set(streamSid, metadata);
      this.trimMetadataEntries();

      this.logger.log({
        streamSid,
        fileName,
        storageKey: mixedUpload.key,
        s3Key: mixedUpload.key,
        mulawBytes: metadata.mulawBytes,
        wavBytes: metadata.wavBytes,
        inboundChunks: active.inboundChunks.length,
        outboundChunks: active.outboundChunks.length,
        inboundTimeline,
        outboundTimeline,
        chunks: metadata.chunks,
        pcmStats: formatPcm16Stats(pcmStats),
        mixStrategy: 'live_call_wall_clock_additive',
        message: 'Voice recording finalized and uploaded to S3',
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

  getRecordingS3Key(streamSid: string): string | undefined {
    const recording = this.finalizedByStreamSid.get(streamSid);
    return (
      this.s3RecordingStorageService.normalizeS3Key(recording?.s3Key) ??
      this.s3RecordingStorageService.normalizeS3Key(recording?.storageKey) ??
      this.s3RecordingStorageService.normalizeS3Key(recording?.recordingS3Url) ??
      undefined
    );
  }

  async resolveRecordingS3Key(streamSid: string): Promise<string | null> {
    const fromMemory = this.getRecordingS3Key(streamSid);
    if (fromMemory) {
      return fromMemory;
    }

    const session = await this.voiceSessionService.resolveByStreamSid(streamSid);
    const fromSession = this.s3RecordingStorageService.normalizeS3Key(
      session?.recordingS3Url,
    );
    if (fromSession) {
      return fromSession;
    }

    if (session?.callId) {
      const call = await this.prisma.call.findUnique({
        where: { id: session.callId },
        select: { recordingS3Url: true },
      });
      const fromCall = this.s3RecordingStorageService.normalizeS3Key(
        call?.recordingS3Url,
      );
      if (fromCall) {
        return fromCall;
      }
    }

    return null;
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
    const {
      storageKey: _storageKey,
      recordingS3Url: _recordingS3Url,
      ...publicMetadata
    } = metadata;
    return publicMetadata;
  }

  async recordingExists(streamSid: string): Promise<boolean> {
    const s3Key = await this.resolveRecordingS3Key(streamSid);
    if (!s3Key) {
      return false;
    }

    return this.s3RecordingStorageService.objectExists(s3Key);
  }

  async openRecordingReadStream(streamSid: string): Promise<Readable | null> {
    const s3Key = await this.resolveRecordingS3Key(streamSid);
    if (!s3Key) {
      return null;
    }

    try {
      return await this.s3RecordingStorageService.createReadStream(s3Key);
    } catch (error) {
      this.logger.error({
        streamSid,
        s3Key,
        err: error,
        message: 'Failed to open S3 recording read stream',
      });
      return null;
    }
  }

  async getSignedRecordingUrl(
    streamSid: string,
    expiresInSeconds = 900,
  ): Promise<{
    streamSid: string;
    s3Key: string;
    expiresInSeconds: number;
    url: string;
  }> {
    if (!this.s3RecordingStorageService.isEnabled()) {
      throw new NotFoundException(
        'S3 recording is not available for this streamSid',
      );
    }

    const s3Key = await this.resolveRecordingS3Key(streamSid);
    if (!s3Key) {
      throw new NotFoundException(
        'S3 recording is not available for this streamSid',
      );
    }

    try {
      const signed = await this.s3RecordingStorageService.getSignedRecordingUrl({
        s3Key,
        expiresInSeconds,
      });

      return {
        streamSid,
        s3Key: signed.s3Key,
        expiresInSeconds: signed.expiresInSeconds,
        url: signed.url,
      };
    } catch (error) {
      this.logger.error({
        streamSid,
        s3Key,
        err: error,
        message: 'Failed to resolve signed S3 recording URL',
      });
      throw new NotFoundException(
        'S3 recording is not available for this streamSid',
      );
    }
  }

  private trimMetadataEntries(): void {
    this.clearOldRecordings(MAX_METADATA_ENTRIES);
  }

  private async saveS3KeyToDb(
    callId: string,
    s3Key: string,
    streamSid: string,
  ): Promise<void> {
    try {
      await this.prisma.call.update({
        where: { id: callId },
        data: { recordingS3Url: s3Key },
      });
      this.logger.log({ streamSid, callId, s3Key, message: 'Recording S3 key saved to DB' });
    } catch (error) {
      this.logger.error({
        streamSid,
        callId,
        err: error,
        message: 'Failed to save recording S3 key to DB',
      });
    }
  }
}
