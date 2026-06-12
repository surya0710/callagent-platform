import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceRuntimeType } from '../../../config/env.validation';
import { MockVoiceRuntimeProvider } from './mock-voice-runtime.provider';
import { OpenAIRealtimeProvider } from './openai-realtime.provider';
import { VoiceRuntimeProvider } from './voice-runtime.provider';

@Injectable()
export class VoiceRuntimeFactory implements OnModuleInit {
  private readonly logger = new Logger(VoiceRuntimeFactory.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mockVoiceRuntime: MockVoiceRuntimeProvider,
    private readonly openAiRealtimeProvider: OpenAIRealtimeProvider,
  ) {}

  onModuleInit(): void {
    const runtime =
      this.configService.get<VoiceRuntimeType>('VOICE_RUNTIME') ??
      VoiceRuntimeType.MOCK;
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model = this.configService.get<string>('OPENAI_REALTIME_MODEL');

    this.logger.log({
      voiceRuntime: runtime,
      openAiRealtimeModel: model,
      openAiKeyConfigured: Boolean(openAiKey),
      message: 'Voice runtime initialized',
    });
  }

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
