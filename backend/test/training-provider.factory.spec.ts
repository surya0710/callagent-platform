import { ConfigService } from '@nestjs/config';
import { AiProviderType } from '../src/config/env.validation';
import { BedrockTrainingProvider } from '../src/modules/training/providers/bedrock-training.provider';
import { MockTrainingProvider } from '../src/modules/training/providers/mock-training.provider';
import { OpenAiTrainingProvider } from '../src/modules/training/providers/openai-training.provider';
import { TrainingProviderFactory } from '../src/modules/training/training-provider.factory';

describe('TrainingProviderFactory', () => {
  const openAiProvider = { name: 'openai' } as OpenAiTrainingProvider;
  const bedrockProvider = { name: 'bedrock' } as BedrockTrainingProvider;
  const mockProvider = { name: 'mock' } as MockTrainingProvider;

  const createFactory = (provider: AiProviderType) => {
    const configService = {
      get: (key: string) => (key === 'AI_PROVIDER' ? provider : undefined),
    } as ConfigService;

    return new TrainingProviderFactory(
      configService,
      openAiProvider,
      bedrockProvider,
      mockProvider,
    );
  };

  it('selects openai training provider', () => {
    const factory = createFactory(AiProviderType.OPENAI);
    expect(factory.getProvider().name).toBe('openai');
  });

  it('selects bedrock training provider', () => {
    const factory = createFactory(AiProviderType.BEDROCK);
    expect(factory.getProvider().name).toBe('bedrock');
  });

  it('selects mock training provider', () => {
    const factory = createFactory(AiProviderType.MOCK);
    expect(factory.getProvider().name).toBe('mock');
  });
});
