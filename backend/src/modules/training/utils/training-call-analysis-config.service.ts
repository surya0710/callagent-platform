import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TrainingCallAnalysisConfigService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.configService.get<string>('TRAINING_CALL_ANALYSIS_ENABLED', 'true') === 'true';
  }

  getAnalysisModel(): string {
    return (
      this.configService.get<string>('TRAINING_CALL_ANALYSIS_MODEL')?.trim() ||
      this.configService.get<string>('OPENAI_MODEL')?.trim() ||
      'gpt-4o'
    );
  }

  getInsightsModel(): string {
    return (
      this.configService.get<string>('TRAINING_INSIGHTS_MODEL')?.trim() ||
      this.getAnalysisModel()
    );
  }

  getBatchSize(): number {
    const raw = this.configService.get<string>('TRAINING_CALL_ANALYSIS_BATCH_SIZE', '5');
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  }
}
