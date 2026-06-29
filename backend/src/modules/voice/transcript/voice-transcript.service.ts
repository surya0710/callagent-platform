import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  CallTranscriptLifecycleStatus,
  TranscriptSegmentSource,
  TranscriptSegmentStatus,
  TranscriptSpeaker,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { QueueService } from '../../../queues/queue.service';
import { VoiceSessionService } from '../voice-session.service';
import { TranscriptEmailService } from '../transcript-email.service';
import { VoiceTranscriptConfigService } from './voice-transcript-config.service';
import { VoiceTranscriptPostCallService } from './voice-transcript-postcall.service';
import { VoiceTranscriptPostProcessService } from './voice-transcript-postprocess.service';
import { detectTranscriptLanguage } from './voice-transcript-prompt.util';
import { S3RecordingStorageService } from '../audio/s3-recording-storage.service';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { IntegrationCallbackService } from '../../integrations/integration-callback.service';
import { sortTranscriptSegments } from './voice-transcript-segment.util';
import {
  PostCallTranscriptJobPayload,
  RealtimeTranscriptCompletedInput,
  RealtimeTranscriptDeltaInput,
  TranscriptLanguage,
  VoiceTranscriptResponseDto,
  VoiceTranscriptSegmentDto,
} from './voice-transcript.types';

interface LiveTranscriptState {
  streamSid: string;
  callId?: string;
  segments: VoiceTranscriptSegmentDto[];
  pendingByItemId: Map<string, { speaker: TranscriptSpeaker; text: string }>;
  realtimeTranscriptCount: number;
  transcriptError?: string;
  transcriptLanguageDetected?: TranscriptLanguage;
}

function formatFlatTranscript(segments: VoiceTranscriptSegmentDto[]): string {
  return sortTranscriptSegments(segments)
    .map((segment) => {
      const label =
        segment.speaker === 'customer'
          ? 'Customer'
          : segment.speaker === 'assistant'
            ? 'Assistant'
            : 'Unknown';
      return `${label}: ${segment.text}`;
    })
    .join('\n');
}

@Injectable()
export class VoiceTranscriptService {
  private readonly logger = new Logger(VoiceTranscriptService.name);
  private readonly liveByStreamSid = new Map<string, LiveTranscriptState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly transcriptConfig: VoiceTranscriptConfigService,
    private readonly postCallService: VoiceTranscriptPostCallService,
    private readonly postProcessService: VoiceTranscriptPostProcessService,
    private readonly s3RecordingStorageService: S3RecordingStorageService,
    private readonly voiceSessionService: VoiceSessionService,
    private readonly transcriptEmailService: TranscriptEmailService,
    @Inject(forwardRef(() => IntegrationCallbackService))
    private readonly integrationCallbackService: IntegrationCallbackService,
  ) {}

  bindCall(streamSid: string, callId: string): void {
    const state = this.ensureLiveState(streamSid);
    state.callId = callId;
    this.voiceSessionService.updateTranscriptState(streamSid, { callId });
  }

  handleRealtimeDelta(input: RealtimeTranscriptDeltaInput): void {
    if (!this.transcriptConfig.isRealtimeEnabled()) {
      return;
    }

    const state = this.ensureLiveState(input.streamSid);
    if (input.callId) {
      state.callId = input.callId;
    }

    const itemKey = input.itemId ?? `${input.speaker}:pending`;
    const pending = state.pendingByItemId.get(itemKey) ?? {
      speaker: input.speaker,
      text: '',
    };
    pending.text += input.delta;
    state.pendingByItemId.set(itemKey, pending);

    this.logger.debug({
      streamSid: input.streamSid,
      speaker: input.speaker,
      message: 'transcript_realtime_delta',
    });

    this.voiceSessionService.updateTranscriptState(input.streamSid, {
      transcriptMode: this.transcriptConfig.getMode(),
      incrementRealtimeTranscriptCount: false,
    });
  }

  async handleRealtimeCompleted(
    input: RealtimeTranscriptCompletedInput,
  ): Promise<void> {
    if (!this.transcriptConfig.isRealtimeEnabled()) {
      return;
    }

    const state = this.ensureLiveState(input.streamSid);
    if (input.callId) {
      state.callId = input.callId;
    }

    const text = input.text.trim();
    if (!text) {
      return;
    }

    const language =
      input.language ?? detectTranscriptLanguage(text);
    const segment: VoiceTranscriptSegmentDto = {
      speaker: input.speaker,
      text,
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
      source: 'realtime',
      status: 'draft',
      language,
      confidence: input.confidence,
    };

    state.segments.push(segment);
    state.segments = sortTranscriptSegments(state.segments);
    state.realtimeTranscriptCount += 1;
    state.transcriptLanguageDetected = this.mergeLanguage(
      state.transcriptLanguageDetected,
      language,
    );

    if (input.itemId) {
      state.pendingByItemId.delete(input.itemId);
    }

    this.logger.log({
      streamSid: input.streamSid,
      speaker: input.speaker,
      message: 'transcript_realtime_completed',
      realtimeTranscriptCount: state.realtimeTranscriptCount,
    });

    this.voiceSessionService.updateTranscriptState(input.streamSid, {
      transcriptMode: this.transcriptConfig.getMode(),
      realtimeTranscriptCount: state.realtimeTranscriptCount,
      finalTranscriptStatus: 'draft',
      transcriptLanguageDetected: state.transcriptLanguageDetected,
    });

    if (state.callId) {
      void this.persistDraftSegment(state.callId, segment).catch((error) => {
        this.recordTranscriptError(input.streamSid, state.callId, error);
      });
    }
  }

  async enqueuePostCallTranscription(payload: PostCallTranscriptJobPayload): Promise<void> {
    if (!this.transcriptConfig.isPostCallEnabled()) {
      return;
    }

    if (!payload.callId) {
      this.logger.warn({
        streamSid: payload.streamSid,
        message: 'transcript_postcall_skipped_no_call_id',
      });
      return;
    }

    this.logger.log({
      callId: payload.callId,
      streamSid: payload.streamSid,
      message: 'transcript_postcall_started',
    });

    await this.markProcessing(payload.callId);

    const call = await this.prisma.call.findUnique({
      where: { id: payload.callId },
      select: { source: true },
    });

    // Integration calls must deliver webhooks reliably without depending on a worker process.
    if (call?.source === 'integration') {
      try {
        await this.processPostCallJob(payload);
      } catch (error) {
        this.recordTranscriptError(payload.streamSid, payload.callId, error);
      }
      return;
    }

    const queueResult = await this.queueService.enqueueTranscript(
      payload as unknown as Record<string, unknown>,
    );
    if (!queueResult.queued) {
      void this.processPostCallJob(payload).catch((error) => {
        this.recordTranscriptError(payload.streamSid, payload.callId, error);
      });
    }
  }

  async processPostCallJob(payload: PostCallTranscriptJobPayload): Promise<void> {
    if (!this.transcriptConfig.isPostCallEnabled()) {
      return;
    }

    try {
      const timelineSegments = await this.loadRealtimeTimelineSegments(
        payload.callId,
      );

      let cleanedSegments: VoiceTranscriptSegmentDto[] = [];
      if (timelineSegments.length > 0) {
        for (const segment of timelineSegments) {
          const cleanedText = await this.postProcessService.cleanTranscript(
            segment.text,
          );
          if (!cleanedText.trim()) {
            continue;
          }
          cleanedSegments.push({
            ...segment,
            text: cleanedText,
            language: detectTranscriptLanguage(cleanedText),
            status: 'final',
          });
        }
        cleanedSegments = sortTranscriptSegments(cleanedSegments);
      }

      if (cleanedSegments.length === 0) {
        cleanedSegments = await this.transcribeRecordingSegments(payload);
      }

      await this.persistFinalSegments(payload.callId, cleanedSegments);

      this.logger.log({
        callId: payload.callId,
        streamSid: payload.streamSid,
        segmentCount: cleanedSegments.length,
        message: 'transcript_postcall_completed',
      });

      this.voiceSessionService.updateTranscriptState(payload.streamSid, {
        finalTranscriptStatus: 'final',
        transcriptLanguageDetected: this.detectOverallLanguage(cleanedSegments),
      });

      void this.transcriptEmailService
        .enqueueAfterFinalTranscript({
          callId: payload.callId,
          streamSid: payload.streamSid,
        })
        .catch((error) => {
          this.logger.error({
            callId: payload.callId,
            streamSid: payload.streamSid,
            message: 'transcript_email_enqueue_failed',
            err: error instanceof Error ? error.message : String(error),
          });
        });

      await this.integrationCallbackService.notifyCallResultReady(
        payload.callId,
        payload.streamSid,
        payload.durationMsEstimate,
      ).then((result) => {
        if (!result.sent) {
          this.logger.warn({
            callId: payload.callId,
            streamSid: payload.streamSid,
            reason:
              'reason' in result && result.reason
                ? result.reason
                : 'status' in result && result.status !== undefined
                  ? `HTTP ${result.status}`
                  : 'unknown',
            message: 'integration_result_webhook_not_sent',
          });
        }
      }).catch((error) => {
        this.logger.error({
          callId: payload.callId,
          streamSid: payload.streamSid,
          message: 'integration_result_webhook_failed',
          err: error instanceof Error ? error.message : String(error),
        });
      });
    } catch (error) {
      this.recordTranscriptError(payload.streamSid, payload.callId, error);
      throw error;
    }
  }

  getLiveTranscript(streamSid: string): VoiceTranscriptResponseDto {
    const state = this.liveByStreamSid.get(streamSid);
    const session = this.voiceSessionService.getByStreamSid(streamSid);

    return {
      streamSid,
      callId: state?.callId ?? session?.callId,
      transcriptStatus: state?.segments.length
        ? 'draft'
        : session?.finalTranscriptStatus ?? 'none',
      transcriptMode: this.transcriptConfig.getMode(),
      transcriptLanguageDetected:
        state?.transcriptLanguageDetected ?? session?.transcriptLanguageDetected,
      transcriptError: state?.transcriptError ?? session?.transcriptError,
      realtimeTranscriptCount:
        state?.realtimeTranscriptCount ?? session?.realtimeTranscriptCount ?? 0,
      transcript: sortTranscriptSegments(state?.segments ?? []),
      content: state?.segments.length
        ? formatFlatTranscript(state.segments)
        : undefined,
    };
  }

  async getCallTranscript(callId: string): Promise<VoiceTranscriptResponseDto | null> {
    const transcript = await this.prisma.callTranscript.findUnique({
      where: { callId },
      include: {
        segments: {
          orderBy: [{ startedAtMs: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!transcript) {
      return null;
    }

    const mappedSegments = transcript.segments.map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
      startedAtMs: segment.startedAtMs ?? undefined,
      endedAtMs: segment.endedAtMs ?? undefined,
      source: segment.source,
      status: segment.status,
      language: (segment.language as TranscriptLanguage | null) ?? undefined,
      confidence: segment.confidence ?? undefined,
      createdAtMs: segment.createdAt.getTime(),
    }));

    return {
      callId,
      transcriptStatus: transcript.lifecycleStatus,
      transcriptMode: (transcript.transcriptMode as VoiceTranscriptResponseDto['transcriptMode']) ?? undefined,
      transcriptLanguageDetected:
        (transcript.transcriptLanguageDetected as TranscriptLanguage | null) ?? undefined,
      transcriptError: transcript.transcriptError ?? undefined,
      realtimeTranscriptCount: transcript.realtimeTranscriptCount,
      transcript: sortTranscriptSegments(mappedSegments),
      content: transcript.content,
    };
  }

  clearLiveState(streamSid: string): void {
    this.liveByStreamSid.delete(streamSid);
  }

  async finalizeLiveTranscriptForCall(
    callId: string,
    streamSid: string,
  ): Promise<void> {
    const state = this.liveByStreamSid.get(streamSid);
    const transcript = await this.prisma.callTranscript.findUnique({
      where: { callId },
      include: { segments: { orderBy: { createdAt: 'asc' } } },
    });

    if (state?.segments.length) {
      const flatContent = formatFlatTranscript(state.segments);
      const languageDetected = this.detectOverallLanguage(state.segments);

      if (transcript) {
        await this.prisma.callTranscript.update({
          where: { callId },
          data: {
            content: flatContent,
            lifecycleStatus: CallTranscriptLifecycleStatus.final,
            transcriptLanguageDetected: languageDetected,
            transcriptError: null,
          },
        });
        await this.prisma.callTranscriptSegment.updateMany({
          where: { callTranscriptId: transcript.id },
          data: { status: TranscriptSegmentStatus.final },
        });
      } else {
        await this.persistFinalSegments(
          callId,
          state.segments.map((segment) => ({
            ...segment,
            status: 'final',
          })),
        );
      }
    } else if (
      transcript &&
      transcript.lifecycleStatus === CallTranscriptLifecycleStatus.draft
    ) {
      await this.prisma.callTranscript.update({
        where: { callId },
        data: { lifecycleStatus: CallTranscriptLifecycleStatus.final },
      });
      await this.prisma.callTranscriptSegment.updateMany({
        where: { callTranscriptId: transcript.id },
        data: { status: TranscriptSegmentStatus.final },
      });
    }

    this.voiceSessionService.updateTranscriptState(streamSid, {
      finalTranscriptStatus: 'final',
    });
  }

  private ensureLiveState(streamSid: string): LiveTranscriptState {
    const existing = this.liveByStreamSid.get(streamSid);
    if (existing) {
      return existing;
    }

    const session = this.voiceSessionService.getByStreamSid(streamSid);
    const created: LiveTranscriptState = {
      streamSid,
      callId: session?.callId,
      segments: [],
      pendingByItemId: new Map(),
      realtimeTranscriptCount: 0,
    };
    this.liveByStreamSid.set(streamSid, created);
    return created;
  }

  private async persistDraftSegment(
    callId: string,
    segment: VoiceTranscriptSegmentDto,
  ): Promise<void> {
    const transcript = await this.prisma.callTranscript.upsert({
      where: { callId },
      create: {
        callId,
        content: segment.text,
        lifecycleStatus: CallTranscriptLifecycleStatus.draft,
        transcriptMode: this.transcriptConfig.getMode(),
        realtimeTranscriptCount: 1,
        transcriptLanguageDetected: segment.language,
      },
      update: {
        lifecycleStatus: CallTranscriptLifecycleStatus.draft,
        transcriptMode: this.transcriptConfig.getMode(),
        realtimeTranscriptCount: { increment: 1 },
        transcriptLanguageDetected: segment.language,
      },
    });

    await this.prisma.callTranscriptSegment.create({
      data: {
        callTranscriptId: transcript.id,
        speaker: segment.speaker as TranscriptSpeaker,
        source: TranscriptSegmentSource.realtime,
        status: TranscriptSegmentStatus.draft,
        language: segment.language,
        text: segment.text,
        startedAtMs: segment.startedAtMs,
        endedAtMs: segment.endedAtMs,
        confidence: segment.confidence,
      },
    });

    const allSegments = await this.prisma.callTranscriptSegment.findMany({
      where: { callTranscriptId: transcript.id },
      orderBy: [{ startedAtMs: 'asc' }, { createdAt: 'asc' }],
    });

    await this.prisma.callTranscript.update({
      where: { id: transcript.id },
      data: {
        content: formatFlatTranscript(
          sortTranscriptSegments(
            allSegments.map((item) => ({
              speaker: item.speaker,
              text: item.text,
              source: item.source,
              status: item.status,
              startedAtMs: item.startedAtMs ?? undefined,
              endedAtMs: item.endedAtMs ?? undefined,
              createdAtMs: item.createdAt.getTime(),
            })) as VoiceTranscriptSegmentDto[],
          ),
        ),
      },
    });
  }

  private async loadRealtimeTimelineSegments(
    callId: string,
  ): Promise<VoiceTranscriptSegmentDto[]> {
    const transcript = await this.prisma.callTranscript.findUnique({
      where: { callId },
      include: {
        segments: {
          where: { source: TranscriptSegmentSource.realtime },
          orderBy: [{ startedAtMs: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!transcript) {
      return [];
    }

    return sortTranscriptSegments(
      transcript.segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => ({
          speaker: segment.speaker,
          text: segment.text,
          startedAtMs: segment.startedAtMs ?? undefined,
          endedAtMs: segment.endedAtMs ?? undefined,
          source: 'realtime',
          status: 'draft',
          language: (segment.language as TranscriptLanguage | null) ?? undefined,
          confidence: segment.confidence ?? undefined,
          createdAtMs: segment.createdAt.getTime(),
        })),
    );
  }

  private async markProcessing(callId: string): Promise<void> {
    await this.prisma.callTranscript.upsert({
      where: { callId },
      create: {
        callId,
        content: '',
        lifecycleStatus: CallTranscriptLifecycleStatus.processing,
        transcriptMode: this.transcriptConfig.getMode(),
      },
      update: {
        lifecycleStatus: CallTranscriptLifecycleStatus.processing,
        transcriptError: null,
      },
    });
  }

  private async persistFinalSegments(
    callId: string,
    segments: VoiceTranscriptSegmentDto[],
  ): Promise<void> {
    const sortedSegments = sortTranscriptSegments(segments);
    const flatContent = formatFlatTranscript(sortedSegments);
    const languageDetected = this.detectOverallLanguage(sortedSegments);

    const transcript = await this.prisma.callTranscript.upsert({
      where: { callId },
      create: {
        callId,
        content: flatContent,
        lifecycleStatus: CallTranscriptLifecycleStatus.final,
        transcriptMode: this.transcriptConfig.getMode(),
        transcriptLanguageDetected: languageDetected,
      },
      update: {
        content: flatContent,
        lifecycleStatus: CallTranscriptLifecycleStatus.final,
        transcriptMode: this.transcriptConfig.getMode(),
        transcriptLanguageDetected: languageDetected,
        transcriptError: null,
      },
    });

    await this.prisma.callTranscriptSegment.deleteMany({
      where: { callTranscriptId: transcript.id },
    });

    if (sortedSegments.length > 0) {
      await this.prisma.callTranscriptSegment.createMany({
        data: sortedSegments.map((segment) => ({
          callTranscriptId: transcript.id,
          speaker: segment.speaker as TranscriptSpeaker,
          source:
            segment.source === 'postcall'
              ? TranscriptSegmentSource.postcall
              : TranscriptSegmentSource.realtime,
          status: TranscriptSegmentStatus.final,
          language: segment.language,
          text: segment.text,
          startedAtMs: segment.startedAtMs,
          endedAtMs: segment.endedAtMs,
          confidence: segment.confidence,
        })),
      });
    }

    await this.queueService.enqueueSummary({ callId }).catch(() => undefined);
  }

  private recordTranscriptError(
    streamSid: string,
    callId: string | undefined,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error({
      streamSid,
      callId,
      message: 'transcript_error',
      err: message,
    });

    this.voiceSessionService.updateTranscriptState(streamSid, {
      finalTranscriptStatus: 'failed',
      transcriptError: message,
    });

    if (!callId) {
      return;
    }

    void this.trySalvageTranscriptAndNotify(callId, streamSid).catch(() =>
      this.markTranscriptFailedAndNotify(callId, streamSid, message),
    );
  }

  private async trySalvageTranscriptAndNotify(
    callId: string,
    streamSid: string,
  ): Promise<void> {
    const liveState = this.liveByStreamSid.get(streamSid);
    if (liveState?.segments.some((segment) => segment.text.trim())) {
      await this.persistFinalSegments(
        callId,
        liveState.segments.map((segment) => ({
          ...segment,
          status: 'final',
        })),
      );
      await this.integrationCallbackService.notifyCallResultReady(
        callId,
        streamSid,
      );
      return;
    }

    const transcript = await this.prisma.callTranscript.findUnique({
      where: { callId },
      include: {
        segments: {
          orderBy: [{ startedAtMs: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    const draftSegments = transcript?.segments.filter((segment) =>
      segment.text.trim(),
    );
    if (draftSegments && draftSegments.length > 0) {
      await this.persistFinalSegments(
        callId,
        sortTranscriptSegments(
          draftSegments.map((segment) => ({
            speaker: segment.speaker,
            text: segment.text,
            startedAtMs: segment.startedAtMs ?? undefined,
            endedAtMs: segment.endedAtMs ?? undefined,
            source:
              segment.source === 'postcall' ? ('postcall' as const) : ('realtime' as const),
            status: 'final' as const,
            language: (segment.language as TranscriptLanguage | null) ?? undefined,
            confidence: segment.confidence ?? undefined,
            createdAtMs: segment.createdAt.getTime(),
          })),
        ),
      );
      await this.integrationCallbackService.notifyCallResultReady(
        callId,
        streamSid,
      );
      return;
    }

    await this.markTranscriptFailedAndNotify(
      callId,
      streamSid,
      'Transcript unavailable',
    );
  }

  private async markTranscriptFailedAndNotify(
    callId: string,
    streamSid: string,
    message: string,
  ): Promise<void> {
    await this.prisma.callTranscript.upsert({
      where: { callId },
      create: {
        callId,
        content: '',
        lifecycleStatus: CallTranscriptLifecycleStatus.failed,
        transcriptError: message,
        transcriptMode: this.transcriptConfig.getMode(),
      },
      update: {
        lifecycleStatus: CallTranscriptLifecycleStatus.failed,
        transcriptError: message,
      },
    });

    await this.integrationCallbackService.notifyCallResultReady(callId, streamSid);
  }

  private mergeLanguage(
    current: TranscriptLanguage | undefined,
    next: TranscriptLanguage,
  ): TranscriptLanguage {
    if (!current || current === 'unknown') {
      return next;
    }
    if (current === next) {
      return current;
    }
    return 'mixed';
  }

  private detectOverallLanguage(
    segments: VoiceTranscriptSegmentDto[],
  ): TranscriptLanguage {
    const languages = segments
      .map((segment) => segment.language)
      .filter(Boolean) as TranscriptLanguage[];

    if (languages.length === 0) {
      return 'unknown';
    }

    const unique = new Set(languages);
    if (unique.size > 1 || unique.has('mixed')) {
      return 'mixed';
    }

    return languages[0] ?? 'unknown';
  }

  private async transcribeRecordingSegments(
    payload: PostCallTranscriptJobPayload,
  ): Promise<VoiceTranscriptSegmentDto[]> {
    const tempDirs: string[] = [];
    let rawSegments: VoiceTranscriptSegmentDto[] = [];

    try {
      const mixedPath = await this.resolveS3KeyToTempPath(
        payload.mixedStorageKey,
        tempDirs,
      );
      const inboundPath = payload.inboundStorageKey
        ? await this.resolveS3KeyToTempPath(payload.inboundStorageKey, tempDirs)
        : undefined;
      const outboundPath = payload.outboundStorageKey
        ? await this.resolveS3KeyToTempPath(payload.outboundStorageKey, tempDirs)
        : undefined;

      rawSegments = await this.postCallService.transcribeRecordingFiles({
        mixedPath,
        inboundPath,
        outboundPath,
        durationMsEstimate: payload.durationMsEstimate,
      });
    } finally {
      await Promise.all(
        tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
      );
    }

    const cleanedSegments: VoiceTranscriptSegmentDto[] = [];
    for (const segment of rawSegments) {
      const cleanedText = await this.postProcessService.cleanTranscript(
        segment.text,
      );
      if (!cleanedText.trim()) {
        continue;
      }
      cleanedSegments.push({
        ...segment,
        text: cleanedText,
        language: detectTranscriptLanguage(cleanedText),
      });
    }

    return sortTranscriptSegments(cleanedSegments);
  }

  private async resolveS3KeyToTempPath(
    s3Key: string,
    tempDirs: string[],
  ): Promise<string> {
    const buffer = await this.s3RecordingStorageService.downloadObject(s3Key);
    const dir = await mkdtemp(path.join(tmpdir(), 'voice-recording-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, path.basename(s3Key));
    await writeFile(filePath, buffer);
    return filePath;
  }
}
