import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  VoiceRecordingStorage,
  VoiceRecordingStorageWriteOptions,
} from './voice-recording-storage.interface';

@Injectable()
export class LocalVoiceRecordingStorage implements VoiceRecordingStorage {
  private readonly basePath: string;

  constructor(private readonly configService: ConfigService) {
    const configuredPath =
      this.configService.get<string>('VOICE_RECORDINGS_STORAGE_PATH') ??
      'storage';
    this.basePath = path.resolve(process.cwd(), configuredPath);
  }

  async write(
    storageKey: string,
    data: Buffer,
    _options: VoiceRecordingStorageWriteOptions,
  ): Promise<void> {
    const absolutePath = this.resolveAbsolutePath(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, data);
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.resolveAbsolutePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  createReadStream(storageKey: string) {
    return createReadStream(this.resolveAbsolutePath(storageKey));
  }

  private resolveAbsolutePath(storageKey: string): string {
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
