import { Injectable, Logger } from '@nestjs/common';
import { Call, CallStatus } from '@prisma/client';

export interface CallStatusCallbackPayload {
  callId: string;
  externalRef: string | null;
  status: CallStatus;
  callPurpose: string | null;
  phone: string;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
  metadata: unknown;
  timestamp: string;
}

@Injectable()
export class IntegrationCallbackService {
  private readonly logger = new Logger(IntegrationCallbackService.name);

  async notifyStatusChange(call: Call) {
    if (!call.callbackUrl || call.source !== 'integration') {
      return { sent: false };
    }

    const payload: CallStatusCallbackPayload = {
      callId: call.id,
      externalRef: call.externalRef,
      status: call.status,
      callPurpose: call.callPurpose,
      phone: call.phone,
      startedAt: call.startedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      failureReason: call.failureReason,
      metadata: call.metadata,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch(call.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Voice-Event': 'call.status_changed',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(
          `Callback failed for call ${call.id}: HTTP ${response.status}`,
        );
        return { sent: false, status: response.status };
      }

      this.logger.log(`Callback sent for call ${call.id} → ${call.callbackUrl}`);
      return { sent: true, status: response.status };
    } catch (error) {
      this.logger.error(
        `Callback error for call ${call.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { sent: false };
    }
  }
}
