import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import {
  VoiceRecordingStorage,
  VoiceRecordingStorageWriteOptions,
} from './voice-recording-storage.interface';

/**
 * S3-backed voice recording storage.
 *
 * To enable:
 * 1. Install @aws-sdk/client-s3
 * 2. Set VOICE_RECORDINGS_STORAGE_DRIVER=s3
 * 3. Set VOICE_RECORDINGS_S3_BUCKET and AWS_REGION
 * 4. Implement write/exists/createReadStream using PutObject, HeadObject, GetObject
 */
@Injectable()
export class S3VoiceRecordingStorage implements VoiceRecordingStorage {
  constructor(private readonly configService: ConfigService) {}

  async write(
    _storageKey: string,
    _data: Buffer,
    _options: VoiceRecordingStorageWriteOptions,
  ): Promise<void> {
    const bucket = this.configService.get<string>('VOICE_RECORDINGS_S3_BUCKET');
    throw new Error(
      `S3 voice recording storage is not implemented yet (bucket=${bucket ?? 'unset'})`,
    );
  }

  async exists(_storageKey: string): Promise<boolean> {
    throw new Error('S3 voice recording storage is not implemented yet');
  }

  createReadStream(_storageKey: string): Readable {
    throw new Error('S3 voice recording storage is not implemented yet');
  }
}
