import { Injectable, Logger } from '@nestjs/common';
import { TrainingCallAnalysisService } from './training-call-analysis.service';

export const TRAINING_ANALYSIS_JOB_NAMES = {
  ANALYZE_CALL: 'analyze-training-call',
  ANALYZE_ALL: 'analyze-all-training-calls',
  AGGREGATE_INSIGHTS: 'aggregate-training-insights',
} as const;

export interface AnalyzeTrainingCallJobPayload {
  recordingId: string;
  reanalyze?: boolean;
}

export interface AnalyzeAllTrainingCallsJobPayload {
  recordingIds?: string[];
}

@Injectable()
export class TrainingCallAnalysisProcessor {
  private readonly logger = new Logger(TrainingCallAnalysisProcessor.name);

  constructor(private readonly analysisService: TrainingCallAnalysisService) {}

  async process(jobName: string, payload: Record<string, unknown>) {
    switch (jobName) {
      case TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_CALL:
        return this.processAnalyzeCall(payload as unknown as AnalyzeTrainingCallJobPayload);
      case TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_ALL:
        return this.processAnalyzeAll(payload as unknown as AnalyzeAllTrainingCallsJobPayload);
      case TRAINING_ANALYSIS_JOB_NAMES.AGGREGATE_INSIGHTS:
        return this.processAggregateInsights();
      default:
        this.logger.warn(`Unknown training analysis job: ${jobName}`);
        return { skipped: true, reason: 'unknown_job' };
    }
  }

  private async processAnalyzeCall(payload: AnalyzeTrainingCallJobPayload) {
    const result = await this.analysisService.analyzeRecording(
      payload.recordingId,
      payload.reanalyze ?? false,
    );
    this.logger.log(`Processed analyze-training-call for ${payload.recordingId}`);
    return { recordingId: payload.recordingId, analysisId: result.id, status: result.status };
  }

  private async processAnalyzeAll(payload: AnalyzeAllTrainingCallsJobPayload) {
    const result = await this.analysisService.analyzeAllRecordings(payload.recordingIds);
    this.logger.log(
      `Processed analyze-all-training-calls: ${result.completed}/${result.total} completed`,
    );
    return result;
  }

  private async processAggregateInsights() {
    const report = await this.analysisService.generateAggregateInsights();
    this.logger.log(`Processed aggregate-training-insights: report ${report.id}`);
    return { reportId: report.id, status: report.status, totalCalls: report.totalCalls };
  }
}
