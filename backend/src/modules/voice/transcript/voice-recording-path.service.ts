import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

@Injectable()
export class VoiceRecordingPathService {
  private readonly basePath: string;

  constructor(private readonly configService: ConfigService) {
    const configuredPath =
      this.configService.get<string>('VOICE_RECORDINGS_STORAGE_PATH') ??
      'storage';
    this.basePath = path.resolve(process.cwd(), configuredPath);
  }

  resolveStorageKey(storageKey: string): string {
    const normalizedKey = storageKey.replace(/\\/g, '/');
    if (
      normalizedKey.startsWith('/') ||
      normalizedKey.includes('..') ||
      path.isAbsolute(normalizedKey)
    ) {
      throw new Error(`Invalid voice recording storage key: ${storageKey}`);
    }

    return path.join(this.basePath, ...normalizedKey.split('/'));
  }
}
