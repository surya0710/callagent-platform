import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildBilingualPostProcessPrompt } from '../../../common/transcription/bilingual-transcription.util';
import { TrainingTranscriptionConfigService } from '../utils/training-transcription-config.service';

@Injectable()
export class TrainingTranscriptPostProcessService {
  private readonly logger = new Logger(TrainingTranscriptPostProcessService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly transcriptionConfig: TrainingTranscriptionConfigService,
  ) {}

  async cleanTranscript(rawTranscript: string): Promise<string> {
    if (!this.transcriptionConfig.isPostProcessEnabled()) {
      return rawTranscript;
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey || !rawTranscript.trim()) {
      return rawTranscript;
    }

    const model = this.transcriptionConfig.getPostProcessModel();
    const prompt = buildBilingualPostProcessPrompt(
      rawTranscript,
      this.transcriptionConfig.getGlossaryTerms(),
      this.transcriptionConfig.shouldPreserveHinglish(),
    );

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content:
                'Return only the cleaned transcript text. Do not add commentary or markdown.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn({
          message: 'training_transcript_postprocess_failed',
          status: response.status,
          errorBody,
        });
        return rawTranscript;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const cleaned = data.choices?.[0]?.message?.content?.trim();
      if (!cleaned) {
        return rawTranscript;
      }

      this.logger.log({ message: 'training_transcript_postprocess_completed' });
      return cleaned;
    } catch (error) {
      this.logger.warn({
        message: 'training_transcript_postprocess_failed',
        err: error instanceof Error ? error.message : String(error),
      });
      return rawTranscript;
    }
  }
}
