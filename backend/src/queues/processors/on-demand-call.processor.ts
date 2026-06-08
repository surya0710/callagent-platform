import { Injectable, Logger } from '@nestjs/common';
import { CallEventType, CallStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { IntegrationCallbackService } from '../../modules/integrations/integration-callback.service';

export interface OnDemandCallJobPayload {
  callId: string;
}

@Injectable()
export class OnDemandCallProcessor {
  private readonly logger = new Logger(OnDemandCallProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly callbackService: IntegrationCallbackService,
  ) {}

  async process(payload: OnDemandCallJobPayload) {
    const call = await this.prisma.call.findUnique({
      where: { id: payload.callId },
    });

    if (!call) {
      this.logger.warn(`On-demand call not found: ${payload.callId}`);
      return { skipped: true };
    }

    const initiated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status: CallStatus.initiated,
        startedAt: new Date(),
        providerRef: `integration-${call.id}`,
      },
    });

    const telephonyContext = this.buildTelephonyContext(initiated.metadata);

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        type: CallEventType.status_change,
        payload: {
          status: CallStatus.initiated,
          telephonyContext,
          note: 'On-demand integration call initiated. Telephony provider integration pending.',
        },
      },
    });

    this.logger.log(
      `On-demand call initiated: callId=${call.id} externalRef=${call.externalRef}`,
    );

    await this.callbackService.notifyStatusChange(initiated);

    // TODO: Pass telephonyContext to voice/telephony provider adapter
    return { callId: initiated.id, status: initiated.status, telephonyContext };
  }

  private buildTelephonyContext(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object') {
      return { scriptHint: 'Generic outbound call' };
    }

    const meta = metadata as Record<string, unknown>;
    const driver = meta.driver as Record<string, string> | null;
    const trip = meta.trip as Record<string, string> | null;
    const purpose = meta.callPurpose as string | undefined;
    const passenger = meta.passenger as Record<string, string> | undefined;

    const scriptHints: Record<string, string> = {
      driver_assigned: `Inform ${passenger?.firstName ?? 'the passenger'} that driver ${driver?.name ?? 'your driver'} is assigned and arriving soon.`,
      ride_reminder: `Remind ${passenger?.firstName ?? 'the passenger'} about their upcoming ride pickup.`,
      pickup_update: `Update ${passenger?.firstName ?? 'the passenger'} on pickup status for ${trip?.pickupAddress ?? 'their location'}.`,
      trip_completed: `Thank ${passenger?.firstName ?? 'the passenger'} for riding with us.`,
      payment_reminder: `Remind ${passenger?.firstName ?? 'the passenger'} about payment for their trip.`,
      custom: 'Custom on-demand call from integration.',
    };

    return {
      callPurpose: purpose,
      scriptHint: scriptHints[purpose ?? 'custom'] ?? scriptHints.custom,
      driver,
      trip,
      passenger,
    };
  }
}
