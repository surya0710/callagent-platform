import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceRecordingStorageDriver } from '../../../../config/env.validation';
import { LocalVoiceRecordingStorage } from './local-voice-recording-storage.provider';
import { S3VoiceRecordingStorage } from './s3-voice-recording-storage.provider';
import { VoiceRecordingStorage } from './voice-recording-storage.interface';

@Injectable()
export class VoiceRecordingStorageFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly localStorage: LocalVoiceRecordingStorage,
    private readonly s3Storage: S3VoiceRecordingStorage,
  ) {}

  getStorage(): VoiceRecordingStorage {
    const driver =
      this.configService.get<VoiceRecordingStorageDriver>(
        'VOICE_RECORDINGS_STORAGE_DRIVER',
      ) ?? VoiceRecordingStorageDriver.LOCAL;

    switch (driver) {
      case VoiceRecordingStorageDriver.S3:
        return this.s3Storage;
      case VoiceRecordingStorageDriver.LOCAL:
      default:
        return this.localStorage;
    }
  }
}
