import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderType } from '../../config/env.validation';
import { TrainingProvider } from './interfaces/training-provider.interface';
import { BedrockTrainingProvider } from './providers/bedrock-training.provider';
import { MockTrainingProvider } from './providers/mock-training.provider';
import { OpenAiTrainingProvider } from './providers/openai-training.provider';

@Injectable()
export class TrainingProviderFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly openAiProvider: OpenAiTrainingProvider,
    private readonly bedrockProvider: BedrockTrainingProvider,
    private readonly mockProvider: MockTrainingProvider,
  ) {}

  getProvider(): TrainingProvider {
    const provider = this.configService.get<AiProviderType>('AI_PROVIDER');

    switch (provider) {
      case AiProviderType.OPENAI:
        return this.openAiProvider;
      case AiProviderType.BEDROCK:
        return this.bedrockProvider;
      case AiProviderType.MOCK:
      default:
        return this.mockProvider;
    }
  }
}
