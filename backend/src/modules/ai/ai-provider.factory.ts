import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderType } from '../../config/env.validation';
import { AiProvider } from './interfaces/ai-provider.interface';
import { BedrockProvider } from './providers/bedrock.provider';
import { MockAiProvider } from './providers/mock-ai.provider';
import { OpenAiProvider } from './providers/openai.provider';

@Injectable()
export class AiProviderFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly openAiProvider: OpenAiProvider,
    private readonly bedrockProvider: BedrockProvider,
    private readonly mockAiProvider: MockAiProvider,
  ) {}

  getProvider(): AiProvider {
    const provider = this.configService.get<AiProviderType>('AI_PROVIDER');

    switch (provider) {
      case AiProviderType.OPENAI:
        return this.openAiProvider;
      case AiProviderType.BEDROCK:
        return this.bedrockProvider;
      case AiProviderType.MOCK:
        return this.mockAiProvider;
      default:
        return this.mockAiProvider;
    }
  }
}
