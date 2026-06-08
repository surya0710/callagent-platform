import { Module } from '@nestjs/common';
import { AiProviderFactory } from './ai-provider.factory';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { BedrockProvider } from './providers/bedrock.provider';
import { MockAiProvider } from './providers/mock-ai.provider';
import { OpenAiProvider } from './providers/openai.provider';

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    AiProviderFactory,
    OpenAiProvider,
    BedrockProvider,
    MockAiProvider,
  ],
  exports: [AiService, AiProviderFactory],
})
export class AiModule {}
