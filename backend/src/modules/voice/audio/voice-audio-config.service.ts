import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseVoiceAudioAutoNormalize,
  parseVoiceAudioGain,
} from './audio-gain.util';

export const SMARTFLO_OUTBOUND_CHUNK_BYTES = 800;
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

  getOutboundChunkMs(): number {
    return (this.getOutboundChunkBytes() / 8000) * 1000;
  }
}
