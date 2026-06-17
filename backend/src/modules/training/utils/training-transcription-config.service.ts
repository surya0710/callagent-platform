import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseGlossaryTerms } from '../../../common/transcription/bilingual-transcription.util';

@Injectable()
export class TrainingTranscriptionConfigService {
  constructor(private readonly configService: ConfigService) {}

  getModel(): string {
    return (
      this.configService.get<string>('TRAINING_TRANSCRIPTION_MODEL')?.trim() ||
      this.configService.get<string>('OPENAI_TRANSCRIPTION_MODEL')?.trim() ||
      'gpt-4o-transcribe'
    );
  }

  getFallbackModels(): string[] {
    const configured = this.getModel();
    return [...new Set([configured, 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'])];
  }

  isPostProcessEnabled(): boolean {
    const training = this.configService.get<string>('TRAINING_TRANSCRIPT_POSTPROCESS_ENABLED');
    if (training !== undefined && training !== '') {
      return this.parseBool(training, true);
    }

    return this.parseBool(
      this.configService.get<string>('VOICE_TRANSCRIPT_POSTPROCESS_ENABLED'),
      true,
    );
  }

  shouldPreserveHinglish(): boolean {
    const training = this.configService.get<string>('TRAINING_TRANSCRIPT_PRESERVE_HINGLISH');
    if (training !== undefined && training !== '') {
      return this.parseBool(training, true);
    }

    return this.parseBool(
      this.configService.get<string>('VOICE_TRANSCRIPT_PRESERVE_HINGLISH'),
      true,
    );
  }

  getGlossaryTerms(): string[] {
    const training = this.configService.get<string>('TRAINING_TRANSCRIPT_GLOSSARY');
    if (training?.trim()) {
      return parseGlossaryTerms(training);
    }

    return parseGlossaryTerms(
      this.configService.get<string>('VOICE_TRANSCRIPT_GLOSSARY'),
    );
  }

  getPostProcessModel(): string {
    return this.configService.get<string>('OPENAI_MODEL')?.trim() ?? 'gpt-4o-mini';
  }

  private parseBool(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
}
