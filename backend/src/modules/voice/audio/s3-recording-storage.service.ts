import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type S3Module = typeof import('@aws-sdk/client-s3');
type S3ClientInstance = InstanceType<S3Module['S3Client']>;

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

export interface GetSignedRecordingUrlParams {
  s3Key: string;
  expiresInSeconds?: number;
}

export interface SignedRecordingUrlResult {
  url: string;
  expiresInSeconds: number;
  s3Key: string;
  bucket: string;
}

@Injectable()
export class S3RecordingStorageService {
  private readonly logger = new Logger(S3RecordingStorageService.name);
  private s3Client: S3ClientInstance | null = null;
  private s3Module: S3Module | null = null;

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
      const { PutObjectCommand } = await this.loadS3Module();
      const client = await this.getClient();
      await client.send(
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

  async getSignedRecordingUrl(
    params: GetSignedRecordingUrlParams,
  ): Promise<SignedRecordingUrlResult> {
    if (!this.isEnabled()) {
      this.logger.warn({
        message: 'S3 recording signed URL requested while S3 upload is disabled',
      });
      throw new Error('S3 recordings are disabled');
    }

    const s3Key = params.s3Key?.trim();
    if (!s3Key) {
      this.logger.error({
        message: 'S3 recording signed URL requested without s3Key',
      });
      throw new Error('S3 recording key is missing');
    }

    const bucket = this.configService.get<string>('S3_RECORDINGS_BUCKET')?.trim();
    if (!bucket) {
      this.logger.error({
        s3Key,
        message: 'S3_RECORDINGS_BUCKET is not configured',
      });
      throw new Error('S3 recordings bucket is not configured');
    }

    const expiresInSeconds = params.expiresInSeconds ?? 900;

    try {
      const { GetObjectCommand } = await this.loadS3Module();
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = await this.getClient();
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: s3Key,
        }),
        { expiresIn: expiresInSeconds },
      );

      this.logger.log({
        s3Key,
        bucket,
        expiresInSeconds,
        message: 'Generated S3 recording signed URL',
      });

      return {
        url,
        expiresInSeconds,
        s3Key,
        bucket,
      };
    } catch (error) {
      this.logger.error({
        s3Key,
        bucket,
        err: error,
        message: 'Failed to generate S3 recording signed URL',
      });
      throw error;
    }
  }

  private async loadS3Module(): Promise<S3Module> {
    if (!this.s3Module) {
      this.s3Module = await import('@aws-sdk/client-s3');
    }

    return this.s3Module;
  }

  private async getClient(): Promise<S3ClientInstance> {
    if (!this.s3Client) {
      const { S3Client } = await this.loadS3Module();
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
