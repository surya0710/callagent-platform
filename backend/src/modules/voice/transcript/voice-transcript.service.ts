import { Injectable, Logger } from '@nestjs/common';
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
import { VoiceRecordingPathService } from './voice-recording-path.service';
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
  return segments
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
    private readonly recordingPathService: VoiceRecordingPathService,
    private readonly voiceSessionService: VoiceSessionService,
    private readonly transcriptEmailService: TranscriptEmailService,
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
      const mixedPath = this.recordingPathService.resolveStorageKey(
        payload.mixedStorageKey,
      );
      const inboundPath = payload.inboundStorageKey
        ? this.recordingPathService.resolveStorageKey(payload.inboundStorageKey)
        : undefined;
      const outboundPath = payload.outboundStorageKey
        ? this.recordingPathService.resolveStorageKey(payload.outboundStorageKey)
        : undefined;

      const rawSegments = await this.postCallService.transcribeRecordingFiles({
        mixedPath,
        inboundPath,
        outboundPath,
        durationMsEstimate: payload.durationMsEstimate,
      });

      const cleanedSegments: VoiceTranscriptSegmentDto[] = [];
      for (const segment of rawSegments) {
        const cleanedText = await this.postProcessService.cleanTranscript(
          segment.text,
        );
        cleanedSegments.push({
          ...segment,
          text: cleanedText,
          language: detectTranscriptLanguage(cleanedText),
        });
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
      transcript: state?.segments ?? [],
      content: state?.segments.length ? formatFlatTranscript(state.segments) : undefined,
    };
  }

  async getCallTranscript(callId: string): Promise<VoiceTranscriptResponseDto | null> {
    const transcript = await this.prisma.callTranscript.findUnique({
      where: { callId },
      include: {
        segments: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!transcript) {
      return null;
    }

    return {
      callId,
      transcriptStatus: transcript.lifecycleStatus,
      transcriptMode: (transcript.transcriptMode as VoiceTranscriptResponseDto['transcriptMode']) ?? undefined,
      transcriptLanguageDetected:
        (transcript.transcriptLanguageDetected as TranscriptLanguage | null) ?? undefined,
      transcriptError: transcript.transcriptError ?? undefined,
      realtimeTranscriptCount: transcript.realtimeTranscriptCount,
      transcript: transcript.segments.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
        startedAtMs: segment.startedAtMs ?? undefined,
        endedAtMs: segment.endedAtMs ?? undefined,
        source: segment.source,
        status: segment.status,
        language: (segment.language as TranscriptLanguage | null) ?? undefined,
        confidence: segment.confidence ?? undefined,
      })),
      content: transcript.content,
    };
  }

  clearLiveState(streamSid: string): void {
    this.liveByStreamSid.delete(streamSid);
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
      orderBy: { createdAt: 'asc' },
    });

    await this.prisma.callTranscript.update({
      where: { id: transcript.id },
      data: {
        content: formatFlatTranscript(
          allSegments.map((item) => ({
            speaker: item.speaker,
            text: item.text,
            source: item.source,
            status: item.status,
          })) as VoiceTranscriptSegmentDto[],
        ),
      },
    });
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
    const flatContent = formatFlatTranscript(segments);
    const languageDetected = this.detectOverallLanguage(segments);

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
      where: {
        callTranscriptId: transcript.id,
        source: TranscriptSegmentSource.postcall,
      },
    });

    if (segments.length > 0) {
      await this.prisma.callTranscriptSegment.createMany({
        data: segments.map((segment) => ({
          callTranscriptId: transcript.id,
          speaker: segment.speaker as TranscriptSpeaker,
          source: TranscriptSegmentSource.postcall,
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

    void this.prisma.callTranscript
      .upsert({
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
      })
      .catch(() => undefined);
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
}
