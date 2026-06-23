import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type NodemailerTransport = {
  sendMail(message: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    text: string;
    attachments?: Array<{
      filename: string;
      content: string;
      contentType?: string;
    }>;
  }): Promise<unknown>;
};

type NodemailerModule = {
  createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }): NodemailerTransport;
};

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.getHost() && this.getFromAddress());
  }

  async send(input: SendEmailInput): Promise<void> {
    const host = this.getHost();
    const from = input.from?.trim() || this.getFromAddress();
    if (!host || !from) {
      throw new Error('SMTP_HOST and SMTP_FROM/TRANSCRIPT_EMAIL_FROM are required');
    }

    const nodemailer = await this.loadNodemailer();
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS') ?? '';
    const transport = nodemailer.createTransport({
      host,
      port: this.getPort(),
      secure: this.getSecure(),
      auth: user ? { user, pass } : undefined,
    });

    await transport.sendMail({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments,
    });
  }

  private async loadNodemailer(): Promise<NodemailerModule> {
    try {
      const module = (await import('nodemailer')) as NodemailerModule;
      return module;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({
        message: 'email_provider_load_failed',
        err: message,
      });
      throw new Error('nodemailer is required for SMTP email delivery');
    }
  }

  private getHost(): string | undefined {
    return this.configService.get<string>('SMTP_HOST')?.trim() || undefined;
  }

  private getFromAddress(): string | undefined {
    return (
      this.configService.get<string>('TRANSCRIPT_EMAIL_FROM')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      undefined
    );
  }

  private getPort(): number {
    const raw = this.configService.get<string>('SMTP_PORT') ?? '587';
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 587;
  }

  private getSecure(): boolean {
    return this.configService.get<string>('SMTP_SECURE', 'false') === 'true';
  }
}
