# Training Workflow From Recorded Calls

This platform does not fine-tune directly on raw audio. Recorded calls are first transcribed, reviewed, redacted, converted into JSONL supervised fine-tuning examples, uploaded to OpenAI Files, and then used to start a supervised fine-tuning job.

Official OpenAI references:

- Speech to text: https://developers.openai.com/api/docs/guides/speech-to-text
- Supervised fine-tuning: https://developers.openai.com/api/docs/guides/supervised-fine-tuning
- Fine-tuning API: https://developers.openai.com/api/reference/resources/fine_tuning

## Flow

1. Upload call recordings in the admin dashboard under `Training`.
2. Transcribe each uploaded recording through the configured training provider.
3. Review and approve the transcript.
4. Provide:
   - an outcome label, such as `interested`, `not_interested`, `callback_requested`
   - the ideal assistant response/behavior that this call should teach
5. Create a JSONL dataset from approved examples.
6. Start a fine-tuning job.
7. Refresh the job until OpenAI returns a completed fine-tuned model ID.
8. Evaluate the model before using it in production.

## Backend endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/training/recordings` | List uploaded recordings |
| `POST` | `/api/training/recordings/upload` | Upload an audio file |
| `POST` | `/api/training/recordings/:id/transcribe` | Transcribe a recording |
| `PATCH` | `/api/training/recordings/:id/approve` | Approve transcript as a training example |
| `GET` | `/api/training/datasets` | List datasets |
| `POST` | `/api/training/datasets` | Create JSONL from approved examples |
| `GET` | `/api/training/datasets/:id/jsonl` | Preview JSONL |
| `POST` | `/api/training/datasets/:id/fine-tune` | Upload JSONL and start fine-tune |
| `GET` | `/api/training/jobs` | List fine-tuning jobs |
| `POST` | `/api/training/jobs/:id/refresh` | Refresh fine-tune status |

## Provider strategy

Training uses a separate provider abstraction:

```typescript
interface TrainingProvider {
  name: string;
  transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioOutput>;
  uploadTrainingFile(input: UploadTrainingFileInput): Promise<UploadTrainingFileOutput>;
  startFineTune(input: StartFineTuneInput): Promise<FineTuneJobOutput>;
  getFineTuneJob(jobId: string): Promise<FineTuneJobOutput>;
}
```

Current implementations:

- `OpenAiTrainingProvider`: real transcription, file upload, fine-tune creation, and job polling
- `MockTrainingProvider`: safe local testing
- `BedrockTrainingProvider`: placeholder for future Bedrock/Nova workflows

## Environment

```env
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_FINE_TUNE_MODEL=gpt-4.1-mini-2025-04-14
```

Use `AI_PROVIDER=mock` for local UI testing without making OpenAI API calls.

## Data safety

The backend applies basic redaction for emails, phone numbers, and long numeric identifiers before examples are written to JSONL. Human review is still required before approval.

Do not approve recordings for training unless:

- you have the right to use the recording for model improvement
- sensitive information has been removed
- the expected assistant response is high quality
- the example represents behavior you want repeated

## Minimum data requirement

OpenAI supervised fine-tuning requires at least 10 training examples. The app lets you upload and prepare smaller batches, but it blocks OpenAI fine-tuning until the dataset has at least 10 approved examples.

For a serious first experiment, collect 50 or more reviewed examples and hold out some calls for evaluation.
