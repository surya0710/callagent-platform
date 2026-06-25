import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiKey,
  Call,
  CallStatus,
  CallTranscriptLifecycleStatus,
  CallTranscriptSegment,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

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

export interface CallResultReadyPayload {
  callId: string;
  externalRef: string | null;
  status: CallStatus;
  phone: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  callContext: unknown;
  metadata: unknown;
  recording: {
    streamSid: string;
    downloadUrl: string;
    durationMsEstimate: number | null;
  };
  transcript: {
    status: CallTranscriptLifecycleStatus | 'none';
    content: string | null;
    language: string | null;
    error: string | null;
    segments: Array<{
      speaker: string;
      text: string;
      startedAtMs: number | null;
      endedAtMs: number | null;
      source: string;
      status: string;
      language: string | null;
    }>;
  };
  timestamp: string;
}

@Injectable()
export class IntegrationCallbackService {
  private readonly logger = new Logger(IntegrationCallbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async resolveWebhookUrl(call: Pick<Call, 'callbackUrl' | 'apiKeyId'>): Promise<string | null> {
    const delivery = await this.resolveWebhookDelivery(call);
    return delivery?.url ?? null;
  }

  private async resolveWebhookDelivery(
    call: Pick<Call, 'callbackUrl' | 'apiKeyId'>,
  ): Promise<{ url: string; authHeaders: Record<string, string> } | null> {
    let url = call.callbackUrl?.trim() || null;
    let apiKey: Pick<
      ApiKey,
      'webhookUrl' | 'webhookAuthType' | 'webhookAuthHeaderName' | 'webhookAuthToken'
    > | null = null;

    if (call.apiKeyId) {
      apiKey = await this.prisma.apiKey.findUnique({
        where: { id: call.apiKeyId },
        select: {
          webhookUrl: true,
          webhookAuthType: true,
          webhookAuthHeaderName: true,
          webhookAuthToken: true,
        },
      });

      if (!url) {
        url = apiKey?.webhookUrl?.trim() || null;
      }
    }

    if (!url) {
      return null;
    }

    return {
      url,
      authHeaders: this.buildWebhookAuthHeaders(apiKey),
    };
  }

  private buildWebhookAuthHeaders(
    apiKey: Pick<
      ApiKey,
      'webhookAuthType' | 'webhookAuthHeaderName' | 'webhookAuthToken'
    > | null,
  ): Record<string, string> {
    if (!apiKey?.webhookAuthToken?.trim()) {
      return {};
    }

    const token = apiKey.webhookAuthToken.trim();

    switch (apiKey.webhookAuthType) {
      case 'bearer':
        return { Authorization: `Bearer ${token}` };
      case 'header': {
        const headerName = apiKey.webhookAuthHeaderName?.trim() || 'X-API-Key';
        return { [headerName]: token };
      }
      default:
        return {};
    }
  }

  async notifyStatusChange(call: Call) {
    if (call.source !== 'integration') {
      return { sent: false };
    }

    const delivery = await this.resolveWebhookDelivery(call);
    if (!delivery) {
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

    return this.postWebhook(
      delivery.url,
      'call.status_changed',
      payload,
      call.id,
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

    if (!call || call.source !== 'integration') {
      return { sent: false, reason: 'not_integration_call' };
    }

    const metadata = asRecord(call.metadata) ?? {};
    const priorDelivery = asRecord(metadata.integrationWebhook);
    if (priorDelivery?.resultDeliveredAt) {
      return { sent: false, reason: 'already_delivered' };
    }

    const delivery = await this.resolveWebhookDelivery(call);
    if (!delivery) {
      return { sent: false, reason: 'no_webhook' };
    }

    const downloadUrl = this.buildRecordingDownloadUrl(streamSid);
    if (!downloadUrl) {
      return { sent: false, reason: 'no_recording_url' };
    }

    const callContext =
      asRecord(metadata.callContext) ??
      asRecord(asRecord(metadata.integration)?.callContext);

    const payload: CallResultReadyPayload = {
      callId: call.id,
      externalRef: call.externalRef,
      status: call.status,
      phone: call.phone,
      startedAt: call.startedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      durationSec: call.durationSec,
      callContext: callContext ?? null,
      metadata,
      recording: {
        streamSid,
        downloadUrl,
        durationMsEstimate:
          typeof durationMsEstimate === 'number' ? durationMsEstimate : null,
      },
      transcript: this.formatTranscriptPayload(call.transcript),
      timestamp: new Date().toISOString(),
    };

    const result = await this.postWebhook(
      delivery.url,
      'call.result_ready',
      payload,
      call.id,
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
    }

    return result;
  }

  private formatTranscriptPayload(
    transcript:
      | {
          lifecycleStatus: CallTranscriptLifecycleStatus;
          content: string | null;
          transcriptLanguageDetected: string | null;
          transcriptError: string | null;
          segments: CallTranscriptSegment[];
        }
      | null
      | undefined,
  ): CallResultReadyPayload['transcript'] {
    if (!transcript) {
      return {
        status: 'none',
        content: null,
        language: null,
        error: null,
        segments: [],
      };
    }

    return {
      status: transcript.lifecycleStatus,
      content: transcript.content,
      language: transcript.transcriptLanguageDetected,
      error: transcript.transcriptError,
      segments: transcript.segments.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
        startedAtMs: segment.startedAtMs,
        endedAtMs: segment.endedAtMs,
        source: segment.source,
        status: segment.status,
        language: segment.language,
      })),
    };
  }

  private buildRecordingDownloadUrl(streamSid: string): string | null {
    const frontendUrl = this.configService.get<string>('FRONTEND_APP_URL')?.trim();
    if (!frontendUrl) {
      return null;
    }

    return `${frontendUrl.replace(/\/+$/, '')}/api/voice/recordings/${encodeURIComponent(streamSid)}/download`;
  }

  private async postWebhook(
    webhookUrl: string,
    event: 'call.status_changed' | 'call.result_ready',
    payload: CallStatusCallbackPayload | CallResultReadyPayload,
    callId: string,
    authHeaders: Record<string, string> = {},
  ) {
    try {
      const response = await fetch(webhookUrl, {
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

      this.logger.log(`${event} webhook sent for call ${callId} → ${webhookUrl}`);
      return { sent: true, status: response.status };
    } catch (error) {
      this.logger.error(
        `${event} webhook error for call ${callId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { sent: false };
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}
