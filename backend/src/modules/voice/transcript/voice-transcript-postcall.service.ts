import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  buildPostCallTranscriptionPrompt,
  detectTranscriptLanguage,
} from './voice-transcript-prompt.util';
import { VoiceTranscriptConfigService } from './voice-transcript-config.service';
import {
  TranscriptSpeaker,
  VoiceTranscriptSegmentDto,
} from './voice-transcript.types';

interface TranscriptionApiResponse {
  text?: string;
}

@Injectable()
export class VoiceTranscriptPostCallService {
  private readonly logger = new Logger(VoiceTranscriptPostCallService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly transcriptConfig: VoiceTranscriptConfigService,
  ) {}

  async transcribeRecordingFiles(input: {
    mixedPath: string;
    inboundPath?: string;
    outboundPath?: string;
    durationMsEstimate?: number;
  }): Promise<VoiceTranscriptSegmentDto[]> {
    const segments: VoiceTranscriptSegmentDto[] = [];

    if (input.inboundPath) {
      const customerText = await this.transcribeFile(input.inboundPath);
      if (customerText) {
        segments.push(
          this.toSegment('customer', customerText, input.durationMsEstimate),
        );
      }
    }

    if (input.outboundPath) {
      const assistantText = await this.transcribeFile(input.outboundPath);
      if (assistantText) {
        segments.push(
          this.toSegment('assistant', assistantText, input.durationMsEstimate),
        );
      }
    }

    if (segments.length > 0) {
      return segments;
    }

    const mixedText = await this.transcribeFile(input.mixedPath);
    if (!mixedText) {
      return [];
    }

    return [this.toSegment('unknown', mixedText, input.durationMsEstimate)];
  }

  private toSegment(
    speaker: TranscriptSpeaker,
    text: string,
    durationMsEstimate?: number,
  ): VoiceTranscriptSegmentDto {
    return {
      speaker,
      text,
      source: 'postcall',
      status: 'final',
      language: detectTranscriptLanguage(text),
      startedAtMs: 0,
      endedAtMs: durationMsEstimate,
    };
  }

  private async transcribeFile(filePath: string): Promise<string | null> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set; skipping post-call transcription');
      return null;
    }

    const model = this.transcriptConfig.getPostCallModel();
    const modelsToTry = [...new Set([model, 'whisper-1'])];
    let lastError = 'Post-call transcription failed';

    for (const candidate of modelsToTry) {
      try {
        return await this.requestTranscription(apiKey, candidate, filePath);
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        this.logger.warn({
          message: 'transcript_postcall_model_fallback',
          model: candidate,
          err: lastError,
        });
      }
    }

    throw new Error(lastError);
  }

  private async requestTranscription(
    apiKey: string,
    model: string,
    filePath: string,
  ): Promise<string | null> {
    const fileBuffer = await readFile(filePath);
    const fileName = path.basename(filePath);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(fileBuffer)], { type: 'audio/wav' }),
      fileName,
    );
    form.append('model', model);
    form.append('response_format', 'json');
    form.append(
      'prompt',
      buildPostCallTranscriptionPrompt(this.transcriptConfig.getGlossaryTerms()),
    );

    const language = this.transcriptConfig.getLanguageHint();
    if (language) {
      form.append('language', language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI post-call transcription failed (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as TranscriptionApiResponse;
    const text = data.text?.trim();
    return text || null;
  }
}
