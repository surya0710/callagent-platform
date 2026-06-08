import { ConfigService } from '@nestjs/config';
import { AiProviderType } from '../src/config/env.validation';
import { AiProviderFactory } from '../src/modules/ai/ai-provider.factory';
import { BedrockProvider } from '../src/modules/ai/providers/bedrock.provider';
import { MockAiProvider } from '../src/modules/ai/providers/mock-ai.provider';
import { OpenAiProvider } from '../src/modules/ai/providers/openai.provider';

describe('AiProviderFactory', () => {
  const openAiProvider = {
    name: 'openai',
  } as OpenAiProvider;
  const bedrockProvider = {
    name: 'bedrock',
  } as BedrockProvider;
  const mockAiProvider = {
    name: 'mock',
  } as MockAiProvider;

  const createFactory = (provider: AiProviderType) => {
    const configService = {
      get: (key: string) => (key === 'AI_PROVIDER' ? provider : undefined),
    } as ConfigService;

    return new AiProviderFactory(
      configService,
      openAiProvider,
      bedrockProvider,
      mockAiProvider,
    );
  };

  it('selects openai provider', () => {
    const factory = createFactory(AiProviderType.OPENAI);
    expect(factory.getProvider().name).toBe('openai');
  });

  it('selects bedrock provider', () => {
    const factory = createFactory(AiProviderType.BEDROCK);
    expect(factory.getProvider().name).toBe('bedrock');
  });

  it('selects mock provider', () => {
    const factory = createFactory(AiProviderType.MOCK);
    expect(factory.getProvider().name).toBe('mock');
  });
});
