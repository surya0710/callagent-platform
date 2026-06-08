import { Injectable, Logger } from '@nestjs/common';
import { CallEventType, CallStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface CallRetryJobPayload {
  callId: string;
  campaignId?: string;
  customerId: string;
  phone: string;
}

@Injectable()
export class CallRetryProcessor {
  private readonly logger = new Logger(CallRetryProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(payload: CallRetryJobPayload) {
    const retryCall = await this.prisma.call.create({
      data: {
        campaignId: payload.campaignId,
        customerId: payload.customerId,
        phone: payload.phone,
        status: CallStatus.queued,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: retryCall.id,
        type: CallEventType.system,
        payload: { action: 'retry', originalCallId: payload.callId },
      },
    });

    const updated = await this.prisma.call.update({
      where: { id: retryCall.id },
      data: { status: CallStatus.initiated, startedAt: new Date() },
    });

    this.logger.log(`Retry call created: ${updated.id} (from ${payload.callId})`);
    return { callId: updated.id };
  }
}
