import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CallTranscriptLifecycleStatus,
  Prisma,
  TranscriptSegmentSource,
  TranscriptSegmentStatus,
  TranscriptSpeaker,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../notifications/email.service';
import { QueueService } from '../../queues/queue.service';
import { VoiceSessionService } from './voice-session.service';
import { SendTranscriptEmailJobPayload } from './transcript/voice-transcript.types';

type TranscriptEmailStatus = 'not_sent' | 'queued' | 'sent' | 'failed' | 'skipped';

interface TranscriptEmailRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

export interface TranscriptEmailStatusResponse {
  status: TranscriptEmailStatus;
  callId?: string | null;
  streamSid?: string | null;
  sentAt?: Date | null;
  reason?: string | null;
  error?: string | null;
  recipients?: {
    to: string[];
    cc: string[];
  };
}

interface ResolvedCallIdentity {
  callId: string;
  streamSid?: string;
}

interface PartialCallIdentity {
  callId?: string;
  streamSid?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class TranscriptEmailService {
  private readonly logger = new Logger(TranscriptEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly queueService: QueueService,
    private readonly voiceSessionService: VoiceSessionService,
  ) {}

  async enqueueAfterFinalTranscript(input: {
    callId: string;
    streamSid?: string;
  }): Promise<void> {
    this.logger.log({
      callId: input.callId,
      streamSid: input.streamSid,
      message: 'transcript_email_enqueue_started',
    });

    if (!this.isEnabled()) {
      await this.createSkippedLog(input, 'Transcript email delivery disabled');
      this.logger.log({
        callId: input.callId,
        streamSid: input.streamSid,
        message: 'transcript_email_skipped',
        reason: 'disabled',
      });
      return;
    }

    const recipients = this.getRecipients();
    if (recipients.to.length === 0) {
      await this.createSkippedLog(input, 'TRANSCRIPT_EMAIL_TO has no valid recipients');
      this.logger.warn({
        callId: input.callId,
        streamSid: input.streamSid,
        message: 'transcript_email_skipped',
        reason: 'missing_recipients',
      });
      return;
    }

    const duplicate = await this.findSentLog(input);
    if (duplicate) {
      await this.createSkippedLog(input, 'Transcript email already sent');
      this.logger.log({
        callId: input.callId,
        streamSid: input.streamSid,
        message: 'transcript_email_duplicate_skipped',
      });
      return;
    }

    const log = await this.prisma.transcriptEmailLog.create({
      data: {
        callId: input.callId,
        streamSid: input.streamSid,
        recipients: this.toRecipientsJson(recipients),
        status: 'pending',
      },
    });

    const queueResult = await this.queueService.enqueueTranscriptEmail({
      callId: input.callId,
      streamSid: input.streamSid,
      logId: log.id,
      trigger: 'auto',
    });

    this.logger.log({
      callId: input.callId,
      streamSid: input.streamSid,
      logId: log.id,
      queued: queueResult.queued,
      message: 'transcript_email_enqueued',
    });

    if (!queueResult.queued) {
      void this.sendTranscriptEmail({
        callId: input.callId,
        streamSid: input.streamSid,
        logId: log.id,
        trigger: 'auto',
      }).catch((error) => {
        this.logger.error({
          callId: input.callId,
          streamSid: input.streamSid,
          logId: log.id,
          message: 'transcript_email_failed',
          err: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  async requestManualSend(input: {
    callId?: string;
    streamSid?: string;
    resend?: boolean;
  }): Promise<TranscriptEmailStatusResponse> {
    if (!this.isEnabled()) {
      throw new BadRequestException('Transcript email delivery is disabled');
    }

    const resolved = await this.resolveCallIdentity(input);
    await this.assertFinalTranscriptAvailable(resolved.callId);

    const recipients = this.getRecipients();
    if (recipients.to.length === 0) {
      throw new BadRequestException('TRANSCRIPT_EMAIL_TO has no valid recipients');
    }

    if (!input.resend) {
      const duplicate = await this.findSentLog(resolved);
      if (duplicate) {
        return this.toStatusResponse(duplicate);
      }
    }

    const log = await this.prisma.transcriptEmailLog.create({
      data: {
        callId: resolved.callId,
        streamSid: resolved.streamSid,
        recipients: this.toRecipientsJson(recipients),
        status: 'pending',
      },
    });

    const queueResult = await this.queueService.enqueueTranscriptEmail({
      callId: resolved.callId,
      streamSid: resolved.streamSid,
      logId: log.id,
      resend: input.resend === true,
      trigger: 'manual',
    });

    if (!queueResult.queued) {
      void this.sendTranscriptEmail({
        callId: resolved.callId,
        streamSid: resolved.streamSid,
        logId: log.id,
        resend: input.resend === true,
        trigger: 'manual',
      }).catch((error) => {
        this.logger.error({
          callId: resolved.callId,
          streamSid: resolved.streamSid,
          logId: log.id,
          message: 'transcript_email_failed',
          err: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return this.toStatusResponse(log);
  }

  async getStatus(input: {
    callId?: string;
    streamSid?: string;
  }): Promise<TranscriptEmailStatusResponse> {
    const resolved = await this.resolveCallIdentity(input, false);
    const log = await this.prisma.transcriptEmailLog.findFirst({
      where: this.identityWhere(resolved),
      orderBy: { createdAt: 'desc' },
    });

    if (!log) {
      return {
        status: 'not_sent',
        callId: resolved.callId,
        streamSid: resolved.streamSid,
      };
    }

    return this.toStatusResponse(log);
  }

  async sendTranscriptEmail(payload: SendTranscriptEmailJobPayload): Promise<void> {
    const resolved = await this.resolveCallIdentity(payload);
    const log = await this.getOrCreatePendingLog(payload, resolved);

    this.logger.log({
      callId: resolved.callId,
      streamSid: resolved.streamSid,
      logId: log.id,
      message: 'transcript_email_send_started',
    });

    try {
      if (!this.isEnabled()) {
        await this.markSkipped(log.id, 'Transcript email delivery disabled');
        return;
      }

      if (this.shouldSendAuthorizedOnly() && resolved.streamSid) {
        const session = await this.voiceSessionService.resolveByStreamSid(
          resolved.streamSid,
        );
        if (session?.isAppInitiated === false) {
          await this.markSkipped(log.id, 'Unauthorized Smartflo stream');
          this.logger.warn({
            callId: resolved.callId,
            streamSid: resolved.streamSid,
            logId: log.id,
            message: 'transcript_email_skipped',
            reason: 'unauthorized_stream',
          });
          return;
        }
      }

      if (!payload.resend) {
        const duplicate = await this.findSentLog(resolved, log.id);
        if (duplicate) {
          await this.markSkipped(log.id, 'Transcript email already sent');
          this.logger.log({
            callId: resolved.callId,
            streamSid: resolved.streamSid,
            logId: log.id,
            message: 'transcript_email_duplicate_skipped',
          });
          return;
        }
      }

      const emailData = await this.buildEmailData(resolved.callId, resolved.streamSid);
      await this.emailService.send(emailData);

      await this.prisma.transcriptEmailLog.update({
        where: { id: log.id },
        data: {
          status: 'sent',
          reason: null,
          error: null,
          sentAt: new Date(),
        },
      });

      this.logger.log({
        callId: resolved.callId,
        streamSid: resolved.streamSid,
        logId: log.id,
        message: 'transcript_email_sent',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof BadRequestException) {
        await this.markSkipped(log.id, message);
        this.logger.warn({
          callId: resolved.callId,
          streamSid: resolved.streamSid,
          logId: log.id,
          message: 'transcript_email_skipped',
          reason: message,
        });
        return;
      }

      await this.prisma.transcriptEmailLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          error: message,
        },
      });
      this.logger.error({
        callId: resolved.callId,
        streamSid: resolved.streamSid,
        logId: log.id,
        message: 'transcript_email_failed',
        err: message,
      });
      throw error;
    }
  }

  private async buildEmailData(callId: string, streamSid?: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        customer: true,
        summary: true,
        transcript: {
          include: {
            segments: {
              where: {
                source: TranscriptSegmentSource.postcall,
                status: TranscriptSegmentStatus.final,
              },
              orderBy: [{ startedAtMs: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    if (call.transcript?.lifecycleStatus !== CallTranscriptLifecycleStatus.final) {
      throw new BadRequestException('Final transcript is not available');
    }

    const segments = call.transcript.segments.filter((segment) =>
      segment.text.trim(),
    );
    if (segments.length === 0) {
      throw new BadRequestException('Final transcript is empty');
    }

    const recipients = this.getRecipients();
    if (recipients.to.length === 0) {
      throw new BadRequestException('TRANSCRIPT_EMAIL_TO has no valid recipients');
    }

    const transcriptText = segments
      .map((segment) => `${this.speakerLabel(segment.speaker)}: ${segment.text}`)
      .join('\n');
    const dashboardUrl = this.getDashboardUrl(call.id);
    const recordingUrl =
      streamSid && this.shouldIncludeRecordingLink()
        ? this.getRecordingUrl(streamSid)
        : undefined;
    const includeSummary = this.shouldIncludeSummary();
    const attachTranscript = this.shouldAttachTranscript();
    const summary = includeSummary ? call.summary?.summary?.trim() : undefined;

    const bodyParts = [
      'Call Transcript',
      '',
      `Call ID: ${call.id}`,
      `Stream SID: ${streamSid ?? 'Not available'}`,
      `Customer: ${call.phone ?? call.customer.phone ?? 'Not available'}`,
      `Started At: ${this.formatDate(call.startedAt)}`,
      `Ended At: ${this.formatDate(call.endedAt)}`,
      `Duration: ${this.formatDuration(call.durationSec, call.startedAt, call.endedAt)}`,
      `Transcript status: final`,
    ];

    if (summary) {
      bodyParts.push('', 'Summary:', summary);
    }

    if (dashboardUrl) {
      bodyParts.push('', 'View in dashboard:', dashboardUrl);
    }

    if (recordingUrl) {
      bodyParts.push('', 'Recording:', recordingUrl);
    }

    if (attachTranscript) {
      bodyParts.push('', 'Transcript:', 'Full transcript is attached as a text file.');
    } else {
      bodyParts.push('', 'Transcript:', transcriptText);
    }

    return {
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      from: this.getFromAddress(),
      subject: this.buildSubject(call.phone, streamSid, call.startedAt),
      text: bodyParts.join('\n'),
      attachments: attachTranscript
        ? [
            {
              filename: `call-transcript-${streamSid ?? call.id}.txt`,
              content: transcriptText,
              contentType: 'text/plain; charset=utf-8',
            },
          ]
        : undefined,
    };
  }

  private async assertFinalTranscriptAvailable(callId: string): Promise<void> {
    const transcript = await this.prisma.callTranscript.findUnique({
      where: { callId },
      include: {
        segments: {
          where: {
            source: TranscriptSegmentSource.postcall,
            status: TranscriptSegmentStatus.final,
          },
        },
      },
    });

    if (!transcript || transcript.lifecycleStatus !== CallTranscriptLifecycleStatus.final) {
      throw new BadRequestException('Final transcript is not available');
    }

    if (!transcript.segments.some((segment) => segment.text.trim())) {
      throw new BadRequestException('Final transcript is empty');
    }
  }

  private async resolveCallIdentity(
    input: { callId?: string; streamSid?: string },
  ): Promise<ResolvedCallIdentity>;
  private async resolveCallIdentity(
    input: { callId?: string; streamSid?: string },
    requireCall: false,
  ): Promise<PartialCallIdentity>;
  private async resolveCallIdentity(
    input: { callId?: string; streamSid?: string },
    requireCall = true,
  ): Promise<PartialCallIdentity> {
    if (input.callId) {
      const call = await this.prisma.call.findUnique({
        where: { id: input.callId },
        select: { id: true },
      });
      if (!call && requireCall) {
        throw new NotFoundException('Call not found');
      }
      return { callId: input.callId, streamSid: input.streamSid };
    }

    if (input.streamSid) {
      const session = await this.voiceSessionService.resolveByStreamSid(input.streamSid);
      if (session?.callId) {
        return { callId: session.callId, streamSid: input.streamSid };
      }

      const log = await this.prisma.transcriptEmailLog.findFirst({
        where: { streamSid: input.streamSid, callId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (log?.callId) {
        return { callId: log.callId, streamSid: input.streamSid };
      }
    }

    if (requireCall) {
      throw new NotFoundException('Call not found for transcript email');
    }

    return { streamSid: input.streamSid };
  }

  private async getOrCreatePendingLog(
    payload: SendTranscriptEmailJobPayload,
    resolved: { callId?: string; streamSid?: string },
  ) {
    if (payload.logId) {
      const existing = await this.prisma.transcriptEmailLog.findUnique({
        where: { id: payload.logId },
      });
      if (existing) {
        return existing;
      }
    }

    return this.prisma.transcriptEmailLog.create({
      data: {
        callId: resolved.callId,
        streamSid: resolved.streamSid,
        recipients: this.toRecipientsJson(this.getRecipients()),
        status: 'pending',
      },
    });
  }

  private async findSentLog(
    input: { callId?: string; streamSid?: string },
    excludeLogId?: string,
  ) {
    return this.prisma.transcriptEmailLog.findFirst({
      where: {
        ...this.identityWhere(input),
        status: 'sent',
        ...(excludeLogId ? { id: { not: excludeLogId } } : {}),
      },
      orderBy: { sentAt: 'desc' },
    });
  }

  private identityWhere(input: { callId?: string; streamSid?: string }) {
    const or: Prisma.TranscriptEmailLogWhereInput[] = [];
    if (input.callId) {
      or.push({ callId: input.callId });
    }
    if (input.streamSid) {
      or.push({ streamSid: input.streamSid });
    }
    return or.length > 0 ? { OR: or } : {};
  }

  private async createSkippedLog(
    input: { callId?: string; streamSid?: string },
    reason: string,
  ): Promise<void> {
    await this.prisma.transcriptEmailLog.create({
      data: {
        callId: input.callId,
        streamSid: input.streamSid,
        recipients: this.toRecipientsJson(this.getRecipients()),
        status: 'skipped',
        reason,
      },
    });
  }

  private async markSkipped(logId: string, reason: string): Promise<void> {
    await this.prisma.transcriptEmailLog.update({
      where: { id: logId },
      data: {
        status: 'skipped',
        reason,
      },
    });
  }

  private toStatusResponse(log: {
    callId: string | null;
    streamSid: string | null;
    status: string;
    sentAt: Date | null;
    reason: string | null;
    error: string | null;
    recipients: Prisma.JsonValue;
  }): TranscriptEmailStatusResponse {
    const status =
      log.status === 'pending'
        ? 'queued'
        : log.status === 'sent' ||
            log.status === 'failed' ||
            log.status === 'skipped'
          ? log.status
          : 'not_sent';
    const recipients = this.fromRecipientsJson(log.recipients);
    return {
      status,
      callId: log.callId,
      streamSid: log.streamSid,
      sentAt: log.sentAt,
      reason: log.reason,
      error: log.error,
      recipients: {
        to: recipients.to,
        cc: recipients.cc,
      },
    };
  }

  private isEnabled(): boolean {
    return this.configService.get<string>('TRANSCRIPT_EMAIL_ENABLED', 'false') === 'true';
  }

  private shouldIncludeSummary(): boolean {
    return (
      this.configService.get<string>('TRANSCRIPT_EMAIL_INCLUDE_SUMMARY', 'true') ===
      'true'
    );
  }

  private shouldIncludeRecordingLink(): boolean {
    return (
      this.configService.get<string>(
        'TRANSCRIPT_EMAIL_INCLUDE_RECORDING_LINK',
        'true',
      ) === 'true'
    );
  }

  private shouldAttachTranscript(): boolean {
    return (
      this.configService.get<string>('TRANSCRIPT_EMAIL_ATTACH_TXT', 'false') ===
      'true'
    );
  }

  private shouldSendAuthorizedOnly(): boolean {
    return (
      this.configService.get<string>(
        'TRANSCRIPT_EMAIL_SEND_FOR_AUTHORIZED_ONLY',
        'true',
      ) === 'true'
    );
  }

  private getRecipients(): TranscriptEmailRecipients {
    return {
      to: this.parseEmailList(this.configService.get<string>('TRANSCRIPT_EMAIL_TO')),
      cc: this.parseEmailList(this.configService.get<string>('TRANSCRIPT_EMAIL_CC')),
      bcc: this.parseEmailList(this.configService.get<string>('TRANSCRIPT_EMAIL_BCC')),
    };
  }

  private parseEmailList(raw: string | undefined): string[] {
    if (!raw) {
      return [];
    }
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && EMAIL_PATTERN.test(item));
  }

  private toRecipientsJson(recipients: TranscriptEmailRecipients): Prisma.InputJsonValue {
    return {
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
    };
  }

  private fromRecipientsJson(value: Prisma.JsonValue): TranscriptEmailRecipients {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { to: [], cc: [], bcc: [] };
    }
    const record = value as Record<string, unknown>;
    return {
      to: Array.isArray(record.to) ? record.to.filter(this.isString) : [],
      cc: Array.isArray(record.cc) ? record.cc.filter(this.isString) : [],
      bcc: Array.isArray(record.bcc) ? record.bcc.filter(this.isString) : [],
    };
  }

  private isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  private speakerLabel(speaker: TranscriptSpeaker): string {
    if (speaker === TranscriptSpeaker.customer) {
      return 'Customer';
    }
    if (speaker === TranscriptSpeaker.assistant) {
      return 'AI Agent';
    }
    return 'Unknown';
  }

  private getFromAddress(): string | undefined {
    return (
      this.configService.get<string>('TRANSCRIPT_EMAIL_FROM')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      undefined
    );
  }

  private buildSubject(
    customerNumber: string | null | undefined,
    streamSid: string | undefined,
    startedAt: Date | null,
  ): string {
    const prefix =
      this.configService.get<string>(
        'TRANSCRIPT_EMAIL_SUBJECT_PREFIX',
        'Call Transcript',
      ) || 'Call Transcript';
    const target = customerNumber || streamSid || 'unknown';
    const date = this.formatDateOnly(startedAt ?? new Date());
    return `${prefix} - ${target} - ${date}`;
  }

  private getDashboardUrl(callId: string): string | undefined {
    if (
      this.configService.get<string>(
        'TRANSCRIPT_EMAIL_INCLUDE_DASHBOARD_LINK',
        'true',
      ) !== 'true'
    ) {
      return undefined;
    }
    const frontendUrl = this.getFrontendUrl();
    return frontendUrl ? `${frontendUrl}/calls/${encodeURIComponent(callId)}` : undefined;
  }

  private getRecordingUrl(streamSid: string): string | undefined {
    const frontendUrl = this.getFrontendUrl();
    return frontendUrl
      ? `${frontendUrl}/api/voice/recordings/${encodeURIComponent(streamSid)}/download`
      : undefined;
  }

  private getFrontendUrl(): string | undefined {
    const raw = this.configService.get<string>('FRONTEND_APP_URL')?.trim();
    return raw ? raw.replace(/\/+$/, '') : undefined;
  }

  private formatDate(value: Date | null | undefined): string {
    return value ? value.toISOString() : 'Not available';
  }

  private formatDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private formatDuration(
    durationSec: number | null | undefined,
    startedAt: Date | null,
    endedAt: Date | null,
  ): string {
    if (typeof durationSec === 'number') {
      return `${durationSec}s`;
    }
    if (startedAt && endedAt) {
      return `${Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))}s`;
    }
    return 'Not available';
  }
}
