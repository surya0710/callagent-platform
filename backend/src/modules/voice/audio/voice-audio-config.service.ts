import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseVoiceAudioGain } from './audio-gain.util';

@Injectable()
export class VoiceAudioConfigService {
  constructor(private readonly configService: ConfigService) {}

  getGain(): number {
    return parseVoiceAudioGain(
      this.configService.get<string>('VOICE_AUDIO_GAIN'),
    );
  }
}
