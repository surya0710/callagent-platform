import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CallEventType,
  CallSource,
  CallStatus,
  CustomerStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { OnDemandCallProcessor } from '../../queues/processors/on-demand-call.processor';
import { QueueService } from '../../queues/queue.service';
import { AgentPromptsService } from '../agent-prompts/agent-prompts.service';
import { IntegrationApiKeyContext } from './interfaces/integration-context.interface';
import { OnDemandCallDto } from './dto/on-demand-call.dto';

@Injectable()
export class IntegrationCallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly onDemandCallProcessor: OnDemandCallProcessor,
    private readonly agentPromptsService: AgentPromptsService,
  ) {}

  async createOnDemandCall(dto: OnDemandCallDto, apiKey: IntegrationApiKeyContext) {
    const existing = await this.prisma.call.findUnique({
      where: {
        apiKeyId_externalRef: {
          apiKeyId: apiKey.id,
          externalRef: dto.externalRef,
        },
      },
    });

    if (existing) {
      return this.formatCallResponse(existing, true);
    }

    const customer = await this.upsertPassenger(dto);

    const callMetadata = this.buildCallMetadata(dto);
    const activePrompt = await this.getActivePromptContext();

    const call = await this.prisma.call.create({
      data: {
        customerId: customer.id,
        apiKeyId: apiKey.id,
        source: CallSource.integration,
        externalRef: dto.externalRef,
        callPurpose: dto.callPurpose,
        phone: dto.passenger.phone,
        priority: dto.priority ?? 'normal',
        callbackUrl: dto.callbackUrl,
        status: CallStatus.queued,
        metadata: {
          ...callMetadata,
          agentContext: activePrompt,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        type: CallEventType.system,
        payload: {
          action: 'integration_requested',
          apiKeyName: apiKey.name,
          callPurpose: dto.callPurpose,
        },
      },
    });

    const jobPayload = { callId: call.id };
    const queueResult = await this.queueService.enqueueOnDemandCall(jobPayload);

    if (!queueResult.queued) {
      await this.onDemandCallProcessor.process(jobPayload);
      const updated = await this.prisma.call.findUniqueOrThrow({
        where: { id: call.id },
      });
      return this.formatCallResponse(updated, false);
    }

    return this.formatCallResponse(call, false);
  }

  async getByExternalRef(externalRef: string, apiKey: IntegrationApiKeyContext) {
    const call = await this.prisma.call.findUnique({
      where: {
        apiKeyId_externalRef: {
          apiKeyId: apiKey.id,
          externalRef,
        },
      },
      include: {
        summary: true,
        transcript: { select: { id: true, createdAt: true } },
      },
    });

    if (!call) {
      throw new NotFoundException(`Call not found for externalRef: ${externalRef}`);
    }

    return this.formatCallResponse(call, true);
  }

  async getById(callId: string, apiKey: IntegrationApiKeyContext) {
    const call = await this.prisma.call.findFirst({
      where: { id: callId, apiKeyId: apiKey.id },
      include: {
        summary: true,
        transcript: { select: { id: true, createdAt: true } },
      },
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    return this.formatCallResponse(call, true);
  }

  private async upsertPassenger(dto: OnDemandCallDto) {
    const existing = await this.prisma.customer.findFirst({
      where: { phone: dto.passenger.phone, deletedAt: null },
    });

    if (existing) {
      return this.prisma.customer.update({
        where: { id: existing.id },
        data: {
          firstName: dto.passenger.firstName,
          lastName: dto.passenger.lastName ?? existing.lastName,
          language: dto.passenger.language ?? existing.language,
          metadata: {
            ...(existing.metadata as Record<string, unknown>),
            lastIntegrationUpdate: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }

    return this.prisma.customer.create({
      data: {
        firstName: dto.passenger.firstName,
        lastName: dto.passenger.lastName ?? 'Passenger',
        phone: dto.passenger.phone,
        language: dto.passenger.language ?? 'en',
        status: CustomerStatus.active,
        metadata: { source: 'integration' } as Prisma.InputJsonValue,
      },
    });
  }

  private buildCallMetadata(dto: OnDemandCallDto) {
    return {
      passenger: dto.passenger,
      driver: dto.driver ?? null,
      trip: dto.trip ?? null,
      callPurpose: dto.callPurpose,
      priority: dto.priority ?? 'normal',
      custom: dto.metadata ?? null,
      integrationType: 'on_demand_driver_service',
    };
  }

  private async getActivePromptContext() {
    const prompts = await this.agentPromptsService.findAll();
    const active = prompts.find((p) => p.isActive);
    return active
      ? { promptId: active.id, promptName: active.name }
      : null;
  }

  private formatCallResponse(
    call: {
      id: string;
      externalRef: string | null;
      status: CallStatus;
      callPurpose: string | null;
      phone: string;
      priority: string;
      metadata: unknown;
      callbackUrl: string | null;
      createdAt: Date;
      startedAt: Date | null;
      endedAt: Date | null;
      summary?: { summary: string; sentiment: string | null } | null;
      transcript?: { id: string } | null;
    },
    idempotent: boolean,
  ) {
    return {
      idempotent,
      call: {
        id: call.id,
        externalRef: call.externalRef,
        status: call.status,
        callPurpose: call.callPurpose,
        phone: call.phone,
        priority: call.priority,
        callbackUrl: call.callbackUrl,
        metadata: call.metadata,
        createdAt: call.createdAt,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        hasTranscript: Boolean(call.transcript),
        summary: call.summary?.summary ?? null,
        sentiment: call.summary?.sentiment ?? null,
      },
    };
  }
}
