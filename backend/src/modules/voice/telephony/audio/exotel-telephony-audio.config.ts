import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelephonyProvider } from '../telephony-provider.types';
import { EXOTEL_PCM16_FRAME_BYTES } from '../exotel-media.util';

export const EXOTEL_DEFAULT_OUTBOUND_CHUNK_BYTES = 3200;
export const EXOTEL_SAMPLE_RATE = 8000;

@Injectable()
export class ExotelTelephonyAudioConfigService {
  constructor(private readonly configService: ConfigService) {}

  getProvider(): TelephonyProvider {
    return TelephonyProvider.EXOTEL;
  }

  getSampleRate(): number {
    return EXOTEL_SAMPLE_RATE;
  }

  getInboundEncoding(): 'pcm16' {
    return 'pcm16';
  }

  getOutboundEncoding(): 'pcm16' {
    return 'pcm16';
  }

  getOutboundChunkBytes(): number {
    const raw = this.configService.get<string>('VOICE_EXOTEL_OUTBOUND_CHUNK_BYTES');
    const parsed = raw ? Number(raw.trim()) : EXOTEL_DEFAULT_OUTBOUND_CHUNK_BYTES;
    if (
      !Number.isFinite(parsed) ||
      parsed < EXOTEL_PCM16_FRAME_BYTES ||
      parsed % EXOTEL_PCM16_FRAME_BYTES !== 0
    ) {
      return EXOTEL_DEFAULT_OUTBOUND_CHUNK_BYTES;
    }
    return parsed;
  }

  getOutboundChunkMs(): number {
    return (this.getOutboundChunkBytes() / 2 / this.getSampleRate()) * 1000;
  }

  getPcm16FrameBytes(): number {
    return EXOTEL_PCM16_FRAME_BYTES;
  }
}
