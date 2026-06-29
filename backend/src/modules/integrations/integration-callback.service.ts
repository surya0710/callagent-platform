import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Call, CallStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  appendWebhookTimeParam,
  buildIntegrationWebhookAuthHeaders,
  buildRecordingDownloadUrl,
  canDeliverIntegrationWebhook,
  resolveIntegrationWebhookUrl,
  resolvePublicAppUrl,
} from './integration-webhook.util';

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

/** Flat payload POSTed to the integration webhook URL on `call.result_ready`. */
export interface IntegrationCallResultWebhookPayload {
  booking_number: string;
  customer_name: string;
  customer_mobile_number: string;
  driver_name: string;
  driver_mobile_number: string;
  recording_url: string;
  transcripts: string;
  call_connected: '0' | '1';
}

@Injectable()
export class IntegrationCallbackService {
  private readonly logger = new Logger(IntegrationCallbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async resolveWebhookUrl(call: Pick<Call, 'apiKeyId' | 'callbackUrl'>): Promise<string | null> {
    const delivery = await this.resolveWebhookDelivery(call);
    return delivery?.url ?? null;
  }

  private async resolveWebhookDelivery(
    call: Pick<Call, 'apiKeyId' | 'callbackUrl'>,
  ): Promise<{ url: string; authHeaders: Record<string, string>; apiKeyId: string } | null> {
    if (!call.apiKeyId) {
      return null;
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id: call.apiKeyId },
      select: {
        id: true,
        webhookUrl: true,
        webhookAuthType: true,
        webhookAuthHeaderName: true,
        webhookAuthToken: true,
      },
    });

    if (!apiKey) {
      this.logger.warn(
        `Webhook skipped: initiating API key ${call.apiKeyId} was not found`,
      );
      return null;
    }

    const url = resolveIntegrationWebhookUrl(apiKey, call.callbackUrl);
    if (!url) {
      return null;
    }

    return {
      url,
      apiKeyId: apiKey.id,
      authHeaders: buildIntegrationWebhookAuthHeaders(apiKey),
    };
  }

  async notifyStatusChange(call: Call) {
    if (!canDeliverIntegrationWebhook(call)) {
      return { sent: false, reason: 'not_api_key_call' };
    }

    const delivery = await this.resolveWebhookDelivery(call);
    if (!delivery) {
      this.logger.warn(
        `call.status_changed skipped for call ${call.id}: initiating API key has no webhook URL`,
      );
      return { sent: false, reason: 'no_webhook' };
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

    return this.postWebhook(
      delivery.url,
      'call.status_changed',
      payload,
      call.id,
      delivery.apiKeyId,
      delivery.authHeaders,
    );
  }

  async notifyCallResultReady(
    callId: string,
    streamSid: string,
    durationMsEstimate?: number,
  ) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        transcript: {
          include: {
            segments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    if (!call || !canDeliverIntegrationWebhook(call)) {
      return { sent: false, reason: 'not_api_key_call' };
    }

    const metadata = asRecord(call.metadata) ?? {};
    const priorDelivery = asRecord(metadata.integrationWebhook);
    if (priorDelivery?.resultDeliveredAt) {
      return { sent: false, reason: 'already_delivered' };
    }

    const delivery = await this.resolveWebhookDelivery(call);
    if (!delivery) {
      this.logger.warn(
        `call.result_ready skipped for call ${callId}: initiating API key ${call.apiKeyId} has no webhook URL`,
      );
      return { sent: false, reason: 'no_webhook' };
    }

    const downloadUrl = this.buildRecordingDownloadUrl(streamSid);
    if (!downloadUrl) {
      this.logger.warn(
        `call.result_ready for call ${callId}: recording URL unavailable (set FRONTEND_APP_URL or VOICE_WSS_BASE_URL)`,
      );
    }

    const callContext =
      asRecord(metadata.callContext) ??
      asRecord(asRecord(metadata.integration)?.callContext);

    const payload = this.buildIntegrationCallResultPayload(
      call,
      callContext,
      downloadUrl,
      call.transcript?.content ?? null,
    );

    const result = await this.postWebhook(
      delivery.url,
      'call.result_ready',
      payload,
      call.id,
      delivery.apiKeyId,
      delivery.authHeaders,
    );

    if (result.sent) {
      await this.prisma.call.update({
        where: { id: callId },
        data: {
          metadata: {
            ...metadata,
            integrationWebhook: {
              ...(priorDelivery ?? {}),
              resultDeliveredAt: new Date().toISOString(),
            },
          },
        },
      });
    } else {
      this.logger.warn(
        `call.result_ready not delivered for call ${callId}: ${describeWebhookResult(result)}`,
      );
    }

    return result;
  }

  private buildIntegrationCallResultPayload(
    call: Call,
    callContext: Record<string, unknown> | undefined,
    recordingUrl: string,
    transcriptContent: string | null,
  ): IntegrationCallResultWebhookPayload {
    const ctx = callContext ?? {};

    return {
      booking_number:
        readContextString(ctx, 'bookingNumber') ?? call.externalRef ?? '',
      customer_name: readContextString(ctx, 'customerName') ?? '',
      customer_mobile_number:
        readContextString(ctx, 'customerNumber') ?? toTenDigitMobile(call.phone),
      driver_name: readContextString(ctx, 'driverName') ?? '',
      driver_mobile_number: readContextString(ctx, 'driverMobileNumber') ?? '',
      recording_url: recordingUrl,
      transcripts: transcriptContent ?? '',
      call_connected: this.resolveCallConnected(call),
    };
  }

  private resolveCallConnected(call: Call): '0' | '1' {
    const connectedStatuses: CallStatus[] = [
      CallStatus.completed,
      CallStatus.answered,
      CallStatus.in_progress,
    ];

    if (connectedStatuses.includes(call.status)) {
      return '1';
    }

    if (call.durationSec != null && call.durationSec > 0) {
      return '1';
    }

    return '0';
  }

  private buildRecordingDownloadUrl(streamSid: string): string {
    const publicAppUrl = resolvePublicAppUrl({
      frontendAppUrl: this.configService.get<string>('FRONTEND_APP_URL'),
      voiceWssBaseUrl: this.configService.get<string>('VOICE_WSS_BASE_URL'),
    });

    return buildRecordingDownloadUrl(publicAppUrl, streamSid);
  }

  private async postWebhook(
    webhookUrl: string,
    event: 'call.status_changed' | 'call.result_ready',
    payload: CallStatusCallbackPayload | IntegrationCallResultWebhookPayload,
    callId: string,
    apiKeyId: string,
    authHeaders: Record<string, string> = {},
  ) {
    const requestUrl = appendWebhookTimeParam(webhookUrl);

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Voice-Event': event,
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(
          `${event} webhook failed for call ${callId}: HTTP ${response.status}`,
        );
        return { sent: false, status: response.status };
      }

      this.logger.log(
        `${event} webhook sent for call ${callId} (apiKey ${apiKeyId}) → ${requestUrl}`,
      );
      return { sent: true, status: response.status };
    } catch (error) {
      this.logger.error(
        `${event} webhook error for call ${callId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { sent: false };
    }
  }
}

function describeWebhookResult(result: {
  sent: boolean;
  reason?: string;
  status?: number;
}): string {
  if ('reason' in result && result.reason) {
    return result.reason;
  }
  if ('status' in result && result.status !== undefined) {
    return `HTTP ${result.status}`;
  }
  return 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readContextString(
  ctx: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = ctx[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toTenDigitMobile(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }

  if (digits.length === 10) {
    return digits;
  }

  return phone;
}
