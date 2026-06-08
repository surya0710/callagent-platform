export interface AiTextInput {
  prompt: string;
  systemPrompt?: string;
  context?: Record<string, unknown>;
}

export interface AiTextOutput {
  text: string;
  provider: string;
  model?: string;
}

export interface CallSummaryInput {
  transcript: string;
  metadata?: Record<string, unknown>;
}

export interface CallSummaryOutput {
  summary: string;
  provider: string;
}

export interface SentimentInput {
  text: string;
}

export interface SentimentOutput {
  label: 'positive' | 'neutral' | 'negative';
  score: number;
  provider: string;
}

export interface AiProvider {
  readonly name: string;
  generateText(input: AiTextInput): Promise<AiTextOutput>;
  summarizeCall(input: CallSummaryInput): Promise<CallSummaryOutput>;
  analyzeSentiment(input: SentimentInput): Promise<SentimentOutput>;
}
