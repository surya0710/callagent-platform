import { Injectable, NotFoundException } from '@nestjs/common';
import { CallEventType, CallStatus, Prisma, SentimentLabel, CallTranscriptLifecycleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QueueService } from '../../queues/queue.service';
import { AiService } from '../ai/ai.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { IntegrationCallbackService } from '../integrations/integration-callback.service';
import { CallQueryDto } from './dto/call-query.dto';
import { CreateCallDto } from './dto/create-call.dto';
import { ProviderWebhookDto } from './dto/provider-webhook.dto';
import { TestCallDto } from './dto/test-call.dto';

export interface LiveCallAnalysis {
  callId: string;
  status: CallStatus;
  phone: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  };
  campaign?: {
    id: string;
    name: string;
  } | null;
  source: string;
  externalRef?: string | null;
  callPurpose?: string | null;
  createdAt: Date;
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationSec?: number | null;
  transcriptStatus?: string;
  transcriptLanguageDetected?: string | null;
  summary?: string | null;
  sentiment?: string | null;
  outcome: string;
  leadQuality: string;
  nextAction: string;
  callbackRequested: boolean;
  customerRequirements: string[];
  objections: string[];
  responseBlockedReason?: string | null;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly aiService: AiService,
    private readonly queueService: QueueService,
    private readonly integrationCallbackService: IntegrationCallbackService,
  ) {}

  async findAll(query: CallQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CallWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search
        ? { phone: { contains: query.search } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.call.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          campaign: { select: { id: true, name: true } },
          summary: true,
        },
      }),
      this.prisma.call.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async listLiveCallAnalyses(): Promise<LiveCallAnalysis[]> {
    const calls = await this.prisma.call.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
        transcript: {
          include: {
            segments: { orderBy: { createdAt: 'asc' } },
          },
        },
        summary: true,
      },
    });

    return calls.map((call) => this.buildLiveCallAnalysis(call));
  }

  async findOne(id: string) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      include: {
        customer: true,
        campaign: true,
        events: { orderBy: { createdAt: 'asc' } },
        transcript: {
          include: {
            segments: { orderBy: { createdAt: 'asc' } },
          },
        },
        summary: true,
      },
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    return call;
  }

  async create(dto: CreateCallDto, userId: string) {
    const call = await this.prisma.call.create({
      data: {
        customerId: dto.customerId,
        campaignId: dto.campaignId,
        phone: dto.phone,
        status: CallStatus.queued,
      },
    });

    await this.recordEvent(call.id, CallEventType.system, { action: 'created' });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'call',
      entityId: call.id,
    });

    return call;
  }

  async testCall(dto: TestCallDto, userId: string) {
    const call = await this.create(dto, userId);

    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status: CallStatus.initiated,
        startedAt: new Date(),
        providerRef: `test-${call.id}`,
      },
    });

    await this.recordEvent(call.id, CallEventType.status_change, {
      status: CallStatus.initiated,
      note: 'Test call placeholder — telephony provider not connected',
    });

    // TODO: Integrate telephony provider for real outbound test calls
    return {
      ...updated,
      message: 'Test call initiated (placeholder). Telephony integration pending.',
    };
  }

  async handleProviderWebhook(dto: ProviderWebhookDto) {
    let call = dto.callId
      ? await this.prisma.call.findUnique({ where: { id: dto.callId } })
      : dto.providerRef
        ? await this.prisma.call.findFirst({ where: { providerRef: dto.providerRef } })
        : null;

    if (!call) {
      return { received: true, matched: false };
    }

    if (dto.status) {
      call = await this.prisma.call.update({
        where: { id: call.id },
        data: {
          status: dto.status,
          ...(dto.status === CallStatus.completed
            ? { endedAt: new Date() }
            : {}),
        },
      });
      await this.integrationCallbackService.notifyStatusChange(call);
    }

    await this.recordEvent(
      call.id,
      CallEventType.webhook,
      (dto.payload ?? {}) as Prisma.InputJsonValue,
    );

    if (dto.payload?.transcript && typeof dto.payload.transcript === 'string') {
      await this.storeTranscript(call.id, dto.payload.transcript);
      const summaryResult = await this.queueService.enqueueSummary({
        callId: call.id,
      });
      if (!summaryResult.queued) {
        await this.generateAndStoreSummary(call.id, dto.payload.transcript);
      }
    }

    return { received: true, matched: true, callId: call.id };
  }

  async getEvents(id: string) {
    await this.findOne(id);
    return this.prisma.callEvent.findMany({
      where: { callId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getTranscript(id: string) {
    const call = await this.findOne(id);
    if (!call.transcript) {
      return null;
    }

    return {
      callId: call.id,
      transcriptStatus: call.transcript.lifecycleStatus,
      transcriptMode: call.transcript.transcriptMode ?? undefined,
      transcriptLanguageDetected:
        call.transcript.transcriptLanguageDetected ?? undefined,
      transcriptError: call.transcript.transcriptError ?? undefined,
      realtimeTranscriptCount: call.transcript.realtimeTranscriptCount,
      content: call.transcript.content,
      transcript: call.transcript.segments.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
        startedAtMs: segment.startedAtMs ?? undefined,
        endedAtMs: segment.endedAtMs ?? undefined,
        source: segment.source,
        status: segment.status,
        language: segment.language ?? undefined,
        confidence: segment.confidence ?? undefined,
      })),
    };
  }

  async getSummary(id: string) {
    const call = await this.findOne(id);
    return call.summary ?? null;
  }

  private buildLiveCallAnalysis(
    call: Prisma.CallGetPayload<{
      include: {
        customer: { select: { id: true; firstName: true; lastName: true } };
        campaign: { select: { id: true; name: true } };
        transcript: { include: { segments: true } };
        summary: true;
      };
    }>,
  ): LiveCallAnalysis {
    const transcriptText =
      call.transcript?.segments
        .map((segment) => `${segment.speaker}: ${segment.text}`)
        .join('\n') ??
      call.transcript?.content ??
      '';
    const combinedText = `${transcriptText}\n${call.summary?.summary ?? ''}`.toLowerCase();

    const callbackRequested =
      /\b(call\s+me\s+later|call\s+later|talk\s+later|not\s+now|busy|callback|call\s+back)\b/.test(
        combinedText,
      ) ||
      /(बाद\s*में|अभी\s*नहीं|व्यस्त|बिजी)/.test(combinedText);
    const notInterested =
      /\b(not\s+interested|no\s+interest|don't\s+need|do\s+not\s+need|stop\s+calling)\b/.test(
        combinedText,
      ) || /(रुचि\s*नहीं|नहीं\s*चाहिए|मत\s*कॉल)/.test(combinedText);
    const interested =
      /\b(interested|yes|sure|okay|ok|go\s+ahead|tell\s+me|send\s+details|share\s+details)\b/.test(
        combinedText,
      ) || /(हाँ|हा|जी|ठीक|बताइए|भेज)/.test(combinedText);
    const priceQuestion =
      /\b(price|pricing|cost|charges|rate|fees|kitna|paise)\b/.test(combinedText) ||
      /(कीमत|कितना|पैसे|चार्ज)/.test(combinedText);
    const timingQuestion =
      /\b(when|timeline|how\s+long|kab|time)\b/.test(combinedText) ||
      /(कब|समय|टाइम)/.test(combinedText);

    const customerRequirements = [
      priceQuestion ? 'Pricing / cost details' : null,
      timingQuestion ? 'Timeline / availability details' : null,
    ].filter((item): item is string => Boolean(item));
    const objections = [
      callbackRequested ? 'Customer asked to call later or indicated they are busy' : null,
      notInterested ? 'Customer said they are not interested' : null,
      priceQuestion ? 'Customer asked about pricing' : null,
    ].filter((item): item is string => Boolean(item));

    const outcome = callbackRequested
      ? 'callback_requested'
      : notInterested
        ? 'not_interested'
        : interested
          ? 'interested'
          : call.status === CallStatus.completed
            ? 'unclear'
            : call.status;
    const leadQuality =
      outcome === 'interested'
        ? 'hot'
        : outcome === 'callback_requested'
          ? 'warm'
          : outcome === 'not_interested'
            ? 'cold'
            : 'unknown';
    const nextAction =
      outcome === 'interested'
        ? 'assign_to_sales'
        : outcome === 'callback_requested'
          ? 'schedule_callback'
          : outcome === 'not_interested'
            ? 'mark_not_interested'
            : call.transcript
              ? 'review_call'
              : 'await_transcript';

    return {
      callId: call.id,
      status: call.status,
      phone: call.phone,
      customer: call.customer,
      campaign: call.campaign,
      source: call.source,
      externalRef: call.externalRef,
      callPurpose: call.callPurpose,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSec: call.durationSec,
      transcriptStatus: call.transcript?.lifecycleStatus,
      transcriptLanguageDetected: call.transcript?.transcriptLanguageDetected,
      summary: call.summary?.summary,
      sentiment: call.summary?.sentiment,
      outcome,
      leadQuality,
      nextAction,
      callbackRequested,
      customerRequirements,
      objections,
    };
  }

  async storeTranscript(callId: string, content: string) {
    return this.prisma.callTranscript.upsert({
      where: { callId },
      update: { content, lifecycleStatus: CallTranscriptLifecycleStatus.final },
      create: { callId, content, lifecycleStatus: CallTranscriptLifecycleStatus.final },
    });
  }

  async generateAndStoreSummary(callId: string, transcript: string) {
    const result = await this.aiService.summarize({ transcript });
    const sentiment = await this.aiService.analyzeSentiment({ text: transcript });

    const labelMap: Record<string, SentimentLabel> = {
      positive: SentimentLabel.positive,
      neutral: SentimentLabel.neutral,
      negative: SentimentLabel.negative,
    };

    return this.prisma.callSummary.upsert({
      where: { callId },
      update: {
        summary: result.summary,
        sentiment: labelMap[sentiment.label] ?? SentimentLabel.neutral,
      },
      create: {
        callId,
        summary: result.summary,
        sentiment: labelMap[sentiment.label] ?? SentimentLabel.neutral,
      },
    });
  }

  private async recordEvent(
    callId: string,
    type: CallEventType,
    payload: Prisma.InputJsonValue,
  ) {
    return this.prisma.callEvent.create({
      data: { callId, type, payload },
    });
  }
}
