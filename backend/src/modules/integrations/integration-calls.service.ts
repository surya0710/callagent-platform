import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CallSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { sanitizeCallContext } from '../voice/voice-call-context.util';
import { CallContext } from '../voice/voice-call-context.types';
import { TelephonyOutboundCallService } from '../voice/telephony/telephony-outbound-call.service';
import { IntegrationApiKeyContext } from './interfaces/integration-context.interface';
import { OnDemandCallDto } from './dto/on-demand-call.dto';
import { IntegrationCallbackService } from './integration-callback.service';

@Injectable()
export class IntegrationCallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telephonyOutboundCallService: TelephonyOutboundCallService,
    private readonly callbackService: IntegrationCallbackService,
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

    const callContext = this.buildCallContext(dto);

    let result;
    try {
      result = await this.telephonyOutboundCallService.initiateCall({
        customerNumber: dto.customerNumber,
        callContext,
        source: 'integration',
        callSource: CallSource.integration,
        integration: {
          apiKeyId: apiKey.id,
          externalRef: dto.externalRef,
          callbackUrl: dto.webhookUrl ?? dto.callbackUrl ?? apiKey.webhookUrl ?? undefined,
          apiKeyName: apiKey.name,
          metadata: dto.metadata,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const raced = await this.prisma.call.findUnique({
          where: {
            apiKeyId_externalRef: {
              apiKeyId: apiKey.id,
              externalRef: dto.externalRef,
            },
          },
        });
        if (raced) {
          return this.formatCallResponse(raced, true);
        }
        throw new ConflictException(
          `Call already exists for externalRef: ${dto.externalRef}`,
        );
      }
      throw error;
    }

    if (!result.success || !result.callId) {
      throw new BadRequestException({
        message: result.message,
        providerResponse: result.providerResponse,
      });
    }

    const call = await this.prisma.call.findUniqueOrThrow({
      where: { id: result.callId },
    });

    await this.callbackService.notifyStatusChange(call);

    return {
      idempotent: false,
      success: true,
      message: result.message,
      authorizationId: result.authorizationId,
      providerCallSid: result.providerCallSid,
      normalizedCustomerNumber: result.normalizedCustomerNumber,
      call: this.formatCallRecord(call),
    };
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

  private buildCallContext(dto: OnDemandCallDto): CallContext | undefined {
    const merged = {
      ...(dto.callContext ?? {}),
      customerNumber: dto.callContext?.customerNumber ?? dto.customerNumber,
      bookingNumber: dto.callContext?.bookingNumber ?? dto.externalRef,
    };

    return sanitizeCallContext(merged);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private formatCallResponse(
    call: {
      id: string;
      externalRef: string | null;
      status: string;
      callPurpose: string | null;
      phone: string;
      priority: string;
      metadata: unknown;
      callbackUrl: string | null;
      providerRef: string | null;
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
      call: this.formatCallRecord(call),
    };
  }

  private formatCallRecord(
    call: {
      id: string;
      externalRef: string | null;
      status: string;
      callPurpose: string | null;
      phone: string;
      priority: string;
      metadata: unknown;
      callbackUrl: string | null;
      providerRef: string | null;
      createdAt: Date;
      startedAt: Date | null;
      endedAt: Date | null;
      summary?: { summary: string; sentiment: string | null } | null;
      transcript?: { id: string } | null;
    },
  ) {
    return {
      id: call.id,
      externalRef: call.externalRef,
      status: call.status,
      callPurpose: call.callPurpose,
      phone: call.phone,
      priority: call.priority,
      webhookUrl: call.callbackUrl,
      callbackUrl: call.callbackUrl,
      providerRef: call.providerRef,
      metadata: call.metadata,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      hasTranscript: Boolean(call.transcript),
      summary: call.summary?.summary ?? null,
      sentiment: call.summary?.sentiment ?? null,
    };
  }
}
