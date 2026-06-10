import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  FineTuneJobOutput,
  StartFineTuneInput,
  TrainingProvider,
  TranscribeAudioInput,
  TranscribeAudioOutput,
  UploadTrainingFileInput,
  UploadTrainingFileOutput,
} from '../interfaces/training-provider.interface';

interface OpenAiTranscriptionResponse {
  text?: string;
}

interface OpenAiFileResponse {
  id?: string;
}

interface OpenAiFineTuneResponse {
  id?: string;
  status?: string;
  fine_tuned_model?: string | null;
  error?: { message?: string } | null;
}

@Injectable()
export class OpenAiTrainingProvider implements TrainingProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiTrainingProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioOutput> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const configuredModel =
      this.configService.get<string>('OPENAI_TRANSCRIPTION_MODEL') ?? 'whisper-1';

    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set; returning placeholder transcript');
      return {
        text: `[openai-transcription-placeholder] ${input.fileName}`,
        provider: this.name,
        model: configuredModel,
      };
    }

    const modelsToTry = [...new Set([configuredModel, 'whisper-1'])];
    let lastError = 'OpenAI transcription failed';

    for (const model of modelsToTry) {
      try {
        return await this.requestTranscription(apiKey, model, input);
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        if (model === modelsToTry[modelsToTry.length - 1]) {
          throw new Error(lastError);
        }
        this.logger.warn(`Transcription failed with model ${model}; trying fallback`);
      }
    }

    throw new Error(lastError);
  }

  private async requestTranscription(
    apiKey: string,
    model: string,
    input: TranscribeAudioInput,
  ): Promise<TranscribeAudioOutput> {
    const fileBuffer = await readFile(input.filePath);
    const mimeType = this.resolveMimeType(input.fileName, input.mimeType);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
      input.fileName,
    );
    form.append('model', model);
    form.append('response_format', 'json');
    if (input.language) {
      form.append('language', input.language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI transcription failed ${response.status}: ${errorBody}`);
      throw new Error(this.parseOpenAiError(errorBody, response.status));
    }

    const data = (await response.json()) as OpenAiTranscriptionResponse;
    const text = data.text?.trim() ?? '';

    if (!text) {
      throw new Error('OpenAI returned an empty transcript');
    }

    return {
      text,
      provider: this.name,
      model,
    };
  }

  private resolveMimeType(fileName: string, mimeType: string): string {
    if (mimeType && mimeType !== 'application/octet-stream') {
      return mimeType;
    }

    const extension = path.extname(fileName).toLowerCase();
    const mimeByExtension: Record<string, string> = {
      '.flac': 'audio/flac',
      '.mp3': 'audio/mpeg',
      '.mp4': 'audio/mp4',
      '.mpeg': 'audio/mpeg',
      '.mpga': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm',
    };

    return mimeByExtension[extension] ?? 'audio/mpeg';
  }

  private parseOpenAiError(errorBody: string, status: number): string {
    try {
      const parsed = JSON.parse(errorBody) as {
        error?: { message?: string };
      };
      if (parsed.error?.message) {
        return `OpenAI transcription failed (${status}): ${parsed.error.message}`;
      }
    } catch {
      // fall through to generic message
    }

    return `OpenAI transcription failed with status ${status}`;
  }

  async uploadTrainingFile(input: UploadTrainingFileInput): Promise<UploadTrainingFileOutput> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set; returning placeholder training file ID');
      return {
        fileId: `openai-placeholder-file-${Date.now()}`,
        provider: this.name,
      };
    }

    const fileBuffer = await readFile(input.filePath);
    const form = new FormData();
    form.append('purpose', 'fine-tune');
    form.append(
      'file',
      new Blob([new Uint8Array(fileBuffer)], { type: 'application/jsonl' }),
      input.fileName,
    );

    const response = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI file upload failed ${response.status}: ${errorBody}`);
      throw new Error(`OpenAI file upload failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenAiFileResponse;
    if (!data.id) {
      throw new Error('OpenAI file upload did not return a file ID');
    }

    return { fileId: data.id, provider: this.name };
  }

  async startFineTune(input: StartFineTuneInput): Promise<FineTuneJobOutput> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set; returning placeholder fine-tune job');
      return {
        providerJobId: `openai-placeholder-ft-${Date.now()}`,
        status: 'queued',
      };
    }

    const response = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        training_file: input.trainingFileId,
        model: input.model,
        suffix: input.suffix,
        method: { type: 'supervised' },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI fine-tune failed ${response.status}: ${errorBody}`);
      throw new Error(`OpenAI fine-tune failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenAiFineTuneResponse;
    return this.toJobOutput(data);
  }

  async getFineTuneJob(jobId: string): Promise<FineTuneJobOutput> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      return {
        providerJobId: jobId,
        status: 'queued',
      };
    }

    const response = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI fine-tune status failed ${response.status}: ${errorBody}`);
      throw new Error(`OpenAI fine-tune status failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenAiFineTuneResponse;
    return this.toJobOutput(data);
  }

  private toJobOutput(data: OpenAiFineTuneResponse): FineTuneJobOutput {
    if (!data.id) {
      throw new Error('OpenAI fine-tune response did not include a job ID');
    }

    return {
      providerJobId: data.id,
      status: data.status ?? 'queued',
      fineTunedModel: data.fine_tuned_model ?? undefined,
      errorMessage: data.error?.message,
    };
  }
}
