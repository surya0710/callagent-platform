import { Injectable } from '@nestjs/common';
import { VoiceAudioConfigService } from '../../audio/voice-audio-config.service';
import { TelephonyProvider } from '../telephony-provider.types';

@Injectable()
export class SmartfloTelephonyAudioConfigService {
  constructor(private readonly voiceAudioConfigService: VoiceAudioConfigService) {}

  getProvider(): TelephonyProvider {
    return TelephonyProvider.SMARTFLO;
  }

  getSampleRate(): number {
    return 8000;
  }

  getInboundEncoding(): 'mulaw' {
    return 'mulaw';
  }

  getOutboundEncoding(): 'mulaw' {
    return 'mulaw';
  }

  getOutboundChunkBytes(): number {
    return this.voiceAudioConfigService.getOutboundChunkBytes();
  }

  getOutboundChunkMs(): number {
    return this.voiceAudioConfigService.getOutboundChunkMs();
  }

  getMulawFrameBytes(): number {
    return 160;
  }
}
