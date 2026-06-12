import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceRuntimeType } from '../../../config/env.validation';
import { MockVoiceRuntimeProvider } from './mock-voice-runtime.provider';
import { OpenAIRealtimeProvider } from './openai-realtime.provider';
import { VoiceRuntimeProvider } from './voice-runtime.provider';

@Injectable()
export class VoiceRuntimeFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly mockVoiceRuntime: MockVoiceRuntimeProvider,
    private readonly openAiRealtimeProvider: OpenAIRealtimeProvider,
  ) {}

  getProvider(): VoiceRuntimeProvider {
    const runtime =
      this.configService.get<VoiceRuntimeType>('VOICE_RUNTIME') ??
      VoiceRuntimeType.MOCK;

    switch (runtime) {
      case VoiceRuntimeType.OPENAI_REALTIME:
        return this.openAiRealtimeProvider;
      case VoiceRuntimeType.MOCK:
      default:
        return this.mockVoiceRuntime;
    }
  }
}
