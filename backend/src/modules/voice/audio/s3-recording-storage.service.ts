import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface S3RecordingUploadSuccess {
  key: string;
  bucket: string;
  uploadedAt: string;
}

export interface S3RecordingUploadFailure {
  error: string;
}

export type S3RecordingUploadResult =
  | S3RecordingUploadSuccess
  | S3RecordingUploadFailure
  | null;

@Injectable()
export class S3RecordingStorageService {
  private readonly logger = new Logger(S3RecordingStorageService.name);
  private s3Client: S3Client | null = null;

  constructor(private readonly configService: ConfigService) {
    if (!this.isEnabled()) {
      this.logger.log({
        message: 'S3 recording upload disabled (S3_RECORDINGS_ENABLED is not true)',
      });
    }
  }

  isEnabled(): boolean {
    return this.configService.get<string>('S3_RECORDINGS_ENABLED') === 'true';
  }

  async uploadRecording(
    wavBuffer: Buffer,
    streamSid: string,
    callSid?: string,
  ): Promise<S3RecordingUploadResult> {
    if (!this.isEnabled()) {
      return null;
    }

    const bucket = this.configService.get<string>('S3_RECORDINGS_BUCKET')?.trim();
    if (!bucket) {
      this.logger.warn({
        streamSid,
        message: 'S3_RECORDINGS_BUCKET is not configured; skipping upload',
      });
      return null;
    }

    const prefix =
      this.configService.get<string>('S3_RECORDINGS_PREFIX')?.trim() ||
      'recordings';
    const date = new Date().toISOString().slice(0, 10);
    const safeStreamSid =
      streamSid.replace(/[^a-zA-Z0-9_-]/g, '_') || 'recording';
    const key = `${prefix}/${date}/${safeStreamSid}.wav`;

    const metadata: Record<string, string> = { streamSid };
    if (callSid) {
      metadata.callSid = callSid;
    }

    this.logger.log({
      streamSid,
      callSid,
      bucket,
      key,
      message: 'Starting S3 recording upload',
    });

    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: wavBuffer,
          ContentType: 'audio/wav',
          Metadata: metadata,
        }),
      );

      this.logger.log({
        streamSid,
        bucket,
        key,
        message: 'S3 recording upload succeeded',
      });

      return {
        key,
        bucket,
        uploadedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error({
        streamSid,
        bucket,
        key,
        err: error,
        message: 'S3 recording upload failed',
      });
      return { error: errorMessage };
    }
  }

  private getClient(): S3Client {
    if (!this.s3Client) {
      const region =
        this.configService.get<string>('AWS_REGION')?.trim() || 'ap-south-1';
      const accessKeyId =
        this.configService.get<string>('AWS_ACCESS_KEY_ID')?.trim();
      const secretAccessKey =
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY')?.trim();

      this.s3Client = new S3Client({
        region,
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
    }

    return this.s3Client;
  }
}
