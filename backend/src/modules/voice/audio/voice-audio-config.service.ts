import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseVoiceAudioAutoNormalize,
  parseVoiceAudioGain,
} from './audio-gain.util';
import { TelephonyMediaEncoding } from '../telephony/telephony-provider.types';

export const SMARTFLO_OUTBOUND_CHUNK_BYTES = 800;
export const EXOTEL_OUTBOUND_CHUNK_BYTES = 3200;
export const SMARTFLO_OUTBOUND_CHUNK_MS = 100;

@Injectable()
export class VoiceAudioConfigService {
  constructor(private readonly configService: ConfigService) {}

  getGain(): number {
    return parseVoiceAudioGain(
      this.configService.get<string>('VOICE_AUDIO_GAIN'),
    );
  }

  isAutoNormalizeEnabled(): boolean {
    return parseVoiceAudioAutoNormalize(
      this.configService.get<string>('VOICE_AUDIO_AUTO_NORMALIZE'),
    );
  }

  getOutboundChunkBytes(): number {
    const raw = this.configService.get<string>('VOICE_OUTBOUND_CHUNK_BYTES');
    const parsed = raw ? Number(raw.trim()) : SMARTFLO_OUTBOUND_CHUNK_BYTES;
    if (!Number.isFinite(parsed) || parsed < 160 || parsed % 160 !== 0) {
      return SMARTFLO_OUTBOUND_CHUNK_BYTES;
    }
    return parsed;
  }

  getOutboundChunkBytesForEncoding(encoding: TelephonyMediaEncoding): number {
    if (encoding === 'pcm16') {
      const raw = this.configService.get<string>(
        'VOICE_EXOTEL_OUTBOUND_CHUNK_BYTES',
      );
      const parsed = raw ? Number(raw.trim()) : EXOTEL_OUTBOUND_CHUNK_BYTES;
      if (
        !Number.isFinite(parsed) ||
        parsed < 320 ||
        parsed % 320 !== 0
      ) {
        return EXOTEL_OUTBOUND_CHUNK_BYTES;
      }
      return parsed;
    }

    return this.getOutboundChunkBytes();
  }

  getOutboundChunkMs(encoding: TelephonyMediaEncoding = 'mulaw'): number {
    const chunkBytes = this.getOutboundChunkBytesForEncoding(encoding);
    const sampleBytes = encoding === 'pcm16' ? 2 : 1;
    return (chunkBytes / sampleBytes / 8000) * 1000;
  }
}
