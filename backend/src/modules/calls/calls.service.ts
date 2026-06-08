import { Injectable, NotFoundException } from '@nestjs/common';
import { CallEventType, CallStatus, Prisma, SentimentLabel } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QueueService } from '../../queues/queue.service';
import { AiService } from '../ai/ai.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { IntegrationCallbackService } from '../integrations/integration-callback.service';
import { CallQueryDto } from './dto/call-query.dto';
import { CreateCallDto } from './dto/create-call.dto';
import { ProviderWebhookDto } from './dto/provider-webhook.dto';
import { TestCallDto } from './dto/test-call.dto';

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

  async findOne(id: string) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      include: {
        customer: true,
        campaign: true,
        events: { orderBy: { createdAt: 'asc' } },
        transcript: true,
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
    return call.transcript ?? null;
  }

  async getSummary(id: string) {
    const call = await this.findOne(id);
    return call.summary ?? null;
  }

  async storeTranscript(callId: string, content: string) {
    return this.prisma.callTranscript.upsert({
      where: { callId },
      update: { content },
      create: { callId, content },
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
