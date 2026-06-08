import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  AiProvider,
  AiTextInput,
  AiTextOutput,
  CallSummaryInput,
  CallSummaryOutput,
  SentimentInput,
  SentimentOutput,
} from '../interfaces/ai-provider.interface';

@Injectable()
export class BedrockProvider implements AiProvider {
  readonly name = 'bedrock';

  async generateText(_input: AiTextInput): Promise<AiTextOutput> {
    throw new NotImplementedException(
      'Amazon Bedrock provider is not implemented yet. Set AI_PROVIDER=openai or mock.',
    );
  }

  async summarizeCall(_input: CallSummaryInput): Promise<CallSummaryOutput> {
    throw new NotImplementedException(
      'Amazon Bedrock call summarization is not implemented yet.',
    );
  }

  async analyzeSentiment(_input: SentimentInput): Promise<SentimentOutput> {
    throw new NotImplementedException(
      'Amazon Bedrock sentiment analysis is not implemented yet.',
    );
  }
}
