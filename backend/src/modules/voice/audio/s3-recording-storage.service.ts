import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

type S3Module = typeof import('@aws-sdk/client-s3');
type S3ClientInstance = InstanceType<S3Module['S3Client']>;

export type RecordingTrackVariant = 'mixed' | 'inbound' | 'outbound';

export interface S3RecordingUploadSuccess {
  key: string;
  bucket: string;
  uploadedAt: string;
  url: string;
}

export interface S3RecordingUploadFailure {
  error: string;
}

export type S3RecordingUploadResult =
  | S3RecordingUploadSuccess
  | S3RecordingUploadFailure;

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

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.configService.get<string>('S3_RECORDINGS_BUCKET')?.trim());
  }

  getBucket(): string {
    const bucket = this.configService.get<string>('S3_RECORDINGS_BUCKET')?.trim();
    if (!bucket) {
      throw new ServiceUnavailableException(
        'S3 recordings bucket is not configured (S3_RECORDINGS_BUCKET missing)',
      );
    }
    return bucket;
  }

  getRegion(): string {
    return this.configService.get<string>('AWS_REGION')?.trim() || 'ap-south-1';
  }

  buildRecordingKey(
    streamSid: string,
    variant: RecordingTrackVariant = 'mixed',
  ): string {
    const prefix =
      this.configService.get<string>('S3_RECORDINGS_PREFIX')?.trim() ||
      'recordings';
    const date = new Date().toISOString().slice(0, 10);
    const safeStreamSid =
      streamSid.replace(/[^a-zA-Z0-9_-]/g, '_') || 'recording';
    const suffix =
      variant === 'mixed'
        ? '.wav'
        : variant === 'inbound'
          ? '_inbound.wav'
          : '_outbound.wav';
    return `${prefix}/${date}/${safeStreamSid}${suffix}`;
  }

  buildHttpUrl(bucket: string, key: string): string {
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `https://${bucket}.s3.${this.getRegion()}.amazonaws.com/${encodedKey}`;
  }

  async uploadRecording(
    wavBuffer: Buffer,
    streamSid: string,
    callSid?: string,
    variant: RecordingTrackVariant = 'mixed',
  ): Promise<S3RecordingUploadResult> {
    const bucket = this.getBucket();
    const key = this.buildRecordingKey(streamSid, variant);

    const metadata: Record<string, string> = { streamSid };
    if (callSid) {
      metadata.callSid = callSid;
    }

    this.logger.log({
      streamSid,
      callSid,
      bucket,
      key,
      variant,
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
        variant,
        message: 'S3 recording upload succeeded',
      });

      return {
        key,
        bucket,
        uploadedAt: new Date().toISOString(),
        url: this.buildHttpUrl(bucket, key),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error({
        streamSid,
        bucket,
        key,
        variant,
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
        message: 'S3 recording signed URL requested while S3 bucket is not configured',
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

    const bucket = this.getBucket();
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

  async objectExists(key: string): Promise<boolean> {
    try {
      const { HeadObjectCommand } = await this.loadS3Module();
      const client = await this.getClient();
      await client.send(
        new HeadObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async downloadObject(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await this.loadS3Module();
    const client = await this.getClient();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object body missing for key: ${key}`);
    }

    return this.bodyToBuffer(response.Body);
  }

  async createReadStream(key: string): Promise<Readable> {
    const { GetObjectCommand } = await this.loadS3Module();
    const client = await this.getClient();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object body missing for key: ${key}`);
    }

    if (response.Body instanceof Readable) {
      return response.Body;
    }

    const buffer = await this.bodyToBuffer(response.Body);
    return Readable.from(buffer);
  }

  private async bodyToBuffer(body: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (
      body &&
      typeof body === 'object' &&
      'transformToByteArray' in body &&
      typeof (body as { transformToByteArray: () => Promise<Uint8Array> })
        .transformToByteArray === 'function'
    ) {
      const bytes = await (
        body as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray();
      return Buffer.from(bytes);
    }

    throw new Error('Unsupported S3 response body type');
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
      const accessKeyId =
        this.configService.get<string>('AWS_ACCESS_KEY_ID')?.trim();
      const secretAccessKey =
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY')?.trim();

      this.s3Client = new S3Client({
        region: this.getRegion(),
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
    }

    return this.s3Client;
  }
}
