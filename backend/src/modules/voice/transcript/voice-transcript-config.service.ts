import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseGlossaryTerms,
  resolveTranscriptionLanguageHint,
} from './voice-transcript-prompt.util';
import { VoiceTranscriptMode } from './voice-transcript.types';

@Injectable()
export class VoiceTranscriptConfigService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.parseBool(
      this.configService.get<string>('VOICE_TRANSCRIPT_ENABLED'),
      true,
    );
  }

  getMode(): VoiceTranscriptMode {
    const raw =
      this.configService.get<string>('VOICE_TRANSCRIPT_MODE')?.trim() ??
      'realtime_and_postcall';

    if (raw === 'realtime' || raw === 'postcall' || raw === 'realtime_and_postcall') {
      return raw;
    }

    return 'realtime_and_postcall';
  }

  isRealtimeEnabled(): boolean {
    if (!this.isEnabled()) {
      return false;
    }

    const mode = this.getMode();
    return mode === 'realtime' || mode === 'realtime_and_postcall';
  }

  isPostCallEnabled(): boolean {
    if (!this.isEnabled()) {
      return false;
    }

    const mode = this.getMode();
    return mode === 'postcall' || mode === 'realtime_and_postcall';
  }

  getLanguageHint(): string | undefined {
    return resolveTranscriptionLanguageHint(
      this.configService.get<string>('VOICE_TRANSCRIPT_LANGUAGE_HINT') ?? 'hi,en',
    );
  }

  shouldPreserveHinglish(): boolean {
    return this.parseBool(
      this.configService.get<string>('VOICE_TRANSCRIPT_PRESERVE_HINGLISH'),
      true,
    );
  }

  getRealtimeModel(): string {
    return (
      this.configService.get<string>('VOICE_TRANSCRIPT_REALTIME_MODEL')?.trim() ??
      'gpt-4o-mini-transcribe'
    );
  }

  getPostCallModel(): string {
    return (
      this.configService.get<string>('VOICE_TRANSCRIPT_POSTCALL_MODEL')?.trim() ??
      'gpt-4o-transcribe'
    );
  }

  isPostProcessEnabled(): boolean {
    return this.parseBool(
      this.configService.get<string>('VOICE_TRANSCRIPT_POSTPROCESS_ENABLED'),
      true,
    );
  }

  getGlossaryTerms(): string[] {
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
