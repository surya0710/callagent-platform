# AI Provider Strategy

The platform avoids vendor lock-in by routing all AI operations through a single provider interface.

## Configuration

```env
AI_PROVIDER=openai   # openai | bedrock | mock
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=
```

## Interface

```typescript
interface AiProvider {
  name: string;
  generateText(input: AiTextInput): Promise<AiTextOutput>;
  summarizeCall(input: CallSummaryInput): Promise<CallSummaryOutput>;
  analyzeSentiment(input: SentimentInput): Promise<SentimentOutput>;
}
```

## Implementations

| Provider | Status | Use case |
|----------|--------|----------|
| `MockAiProvider` | Ready | Local development and tests |
| `OpenAiProvider` | Placeholder API integration | Current default production path |
| `BedrockProvider` | Throws `NotImplementedException` | Future Amazon Nova Sonic / Bedrock |

## Factory

`AiProviderFactory` reads `AI_PROVIDER` and returns the matching implementation. Controllers and services never import OpenAI or AWS SDKs directly.

## Planned integrations

1. **OpenAI** — Chat Completions for summaries, sentiment, and agent responses
2. **Amazon Bedrock** — Nova Sonic for real-time voice and text models for post-call analysis
3. **Intent detection** — Provider-agnostic wrapper once telephony streaming is connected

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai/test-response` | Test text generation |
| POST | `/api/ai/summarize` | Summarize call transcript |
| POST | `/api/ai/sentiment` | Analyze text sentiment |
