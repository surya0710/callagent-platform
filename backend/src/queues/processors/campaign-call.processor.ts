import { Injectable, Logger } from '@nestjs/common';
import { CallEventType, CallSource, CallStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface CampaignCallJobPayload {
  campaignId: string;
  customerId: string;
  phone: string;
  scheduledAt?: string;
}

@Injectable()
export class CampaignCallProcessor {
  private readonly logger = new Logger(CampaignCallProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(payload: CampaignCallJobPayload) {
    const call = await this.prisma.call.create({
      data: {
        campaignId: payload.campaignId,
        customerId: payload.customerId,
        phone: payload.phone,
        source: CallSource.campaign,
        status: CallStatus.queued,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        type: CallEventType.system,
        payload: { action: 'queued', scheduledAt: payload.scheduledAt },
      },
    });

    const initiated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status: CallStatus.initiated,
        startedAt: new Date(),
        providerRef: `campaign-${call.id}`,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        type: CallEventType.status_change,
        payload: {
          status: CallStatus.initiated,
          note: 'Call initiated by campaign worker. Telephony provider integration pending.',
        },
      },
    });

    this.logger.log(
      `Campaign call created: callId=${initiated.id} campaignId=${payload.campaignId}`,
    );

    // TODO: Integrate telephony provider to place actual outbound call
    return { callId: initiated.id, status: initiated.status };
  }
}
