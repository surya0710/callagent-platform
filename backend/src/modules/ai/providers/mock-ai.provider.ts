import { Injectable } from '@nestjs/common';
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
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async generateText(input: AiTextInput): Promise<AiTextOutput> {
    return {
      text: `[mock] Response to: ${input.prompt.slice(0, 120)}`,
      provider: this.name,
      model: 'mock-v1',
    };
  }

  async summarizeCall(input: CallSummaryInput): Promise<CallSummaryOutput> {
    const wordCount = input.transcript.split(/\s+/).filter(Boolean).length;
    return {
      summary: `[mock] Call summary (${wordCount} words in transcript).`,
      provider: this.name,
    };
  }

  async analyzeSentiment(input: SentimentInput): Promise<SentimentOutput> {
    const lower = input.text.toLowerCase();
    let label: SentimentOutput['label'] = 'neutral';

    if (/(great|good|happy|thanks|excellent)/.test(lower)) {
      label = 'positive';
    } else if (/(bad|angry|upset|terrible|no)/.test(lower)) {
      label = 'negative';
    }

    return {
      label,
      score: label === 'neutral' ? 0.5 : label === 'positive' ? 0.85 : 0.15,
      provider: this.name,
    };
  }
}
