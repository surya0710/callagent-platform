import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildPostProcessPrompt } from './voice-transcript-prompt.util';
import { VoiceTranscriptConfigService } from './voice-transcript-config.service';

@Injectable()
export class VoiceTranscriptPostProcessService {
  private readonly logger = new Logger(VoiceTranscriptPostProcessService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly transcriptConfig: VoiceTranscriptConfigService,
  ) {}

  async cleanTranscript(rawTranscript: string): Promise<string> {
    if (!this.transcriptConfig.isPostProcessEnabled()) {
      return rawTranscript;
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey || !rawTranscript.trim()) {
      return rawTranscript;
    }

    const model = this.transcriptConfig.getPostProcessModel();
    const prompt = buildPostProcessPrompt(
      rawTranscript,
      this.transcriptConfig.getGlossaryTerms(),
      this.transcriptConfig.shouldPreserveHinglish(),
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
          message: 'transcript_postprocess_failed',
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

      this.logger.log({ message: 'transcript_postprocess_completed' });
      return cleaned;
    } catch (error) {
      this.logger.warn({
        message: 'transcript_postprocess_failed',
        err: error instanceof Error ? error.message : String(error),
      });
      return rawTranscript;
    }
  }
}
