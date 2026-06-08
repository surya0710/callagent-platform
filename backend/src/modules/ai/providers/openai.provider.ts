import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiTextInput,
  AiTextOutput,
  CallSummaryInput,
  CallSummaryOutput,
  SentimentInput,
  SentimentOutput,
} from '../interfaces/ai-provider.interface';

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async generateText(input: AiTextInput): Promise<AiTextOutput> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';

    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set; returning placeholder response');
      return {
        text: `[openai-placeholder] ${input.prompt.slice(0, 200)}`,
        provider: this.name,
        model,
      };
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (input.systemPrompt) {
      messages.push({ role: 'system', content: input.systemPrompt });
    }
    messages.push({ role: 'user', content: input.prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, temperature: 0.3 }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI API error ${response.status}: ${errorBody}`);
      throw new Error(`OpenAI API request failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';

    return { text, provider: this.name, model };
  }

  async summarizeCall(input: CallSummaryInput): Promise<CallSummaryOutput> {
    const result = await this.generateText({
      prompt: `Summarize this outbound call transcript in 2-4 sentences:\n\n${input.transcript}`,
      systemPrompt:
        'You summarize outbound sales/support calls concisely. Focus on outcome, customer intent, and next steps.',
    });

    return { summary: result.text, provider: this.name };
  }

  async analyzeSentiment(input: SentimentInput): Promise<SentimentOutput> {
    const result = await this.generateText({
      prompt: input.text,
      systemPrompt:
        'Analyze the sentiment of the text. Reply with exactly one word: positive, neutral, or negative.',
    });

    const label = (['positive', 'neutral', 'negative'] as const).find((v) =>
      result.text.toLowerCase().includes(v),
    ) ?? 'neutral';

    return {
      label,
      score: label === 'positive' ? 0.8 : label === 'negative' ? 0.2 : 0.5,
      provider: this.name,
    };
  }
}
