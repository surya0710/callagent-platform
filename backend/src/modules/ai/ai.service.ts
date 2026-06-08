import { Injectable } from '@nestjs/common';
import { AiProviderFactory } from './ai-provider.factory';
import {
  AiSentimentDto,
  AiSummarizeDto,
  AiTestResponseDto,
} from './dto/ai-request.dto';

@Injectable()
export class AiService {
  constructor(private readonly providerFactory: AiProviderFactory) {}

  testResponse(dto: AiTestResponseDto) {
    const provider = this.providerFactory.getProvider();
    return provider.generateText({
      prompt: dto.prompt,
      systemPrompt: dto.systemPrompt,
      context: dto.context,
    });
  }

  summarize(dto: AiSummarizeDto) {
    const provider = this.providerFactory.getProvider();
    return provider.summarizeCall({
      transcript: dto.transcript,
      metadata: dto.metadata,
    });
  }

  analyzeSentiment(dto: AiSentimentDto) {
    const provider = this.providerFactory.getProvider();
    return provider.analyzeSentiment({ text: dto.text });
  }
}
