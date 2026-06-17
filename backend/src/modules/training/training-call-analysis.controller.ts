import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { QueueService } from '../../queues/queue.service';
import { TrainingCallAnalysisProcessor } from './training-call-analysis.processor';
import { TRAINING_ANALYSIS_JOB_NAMES } from './training-call-analysis.processor';
import { TrainingCallAnalysisService } from './training-call-analysis.service';

@ApiTags('Training')
@ApiBearerAuth()
@Controller('training')
export class TrainingCallAnalysisController {
  private readonly logger = new Logger(TrainingCallAnalysisController.name);

  constructor(
    private readonly analysisService: TrainingCallAnalysisService,
    private readonly analysisProcessor: TrainingCallAnalysisProcessor,
    private readonly queueService: QueueService,
  ) {}

  @Post('recordings/analyze-all')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Queue analysis for all transcribed training recordings' })
  async analyzeAll(@Body('recordingIds') recordingIds?: string[]) {
    this.analysisService.assertEnabled();
    const ids = await this.analysisService.findTranscribedRecordingIds(recordingIds);

    await Promise.all(
      ids.map((id) => this.analysisService.enqueueRecordingAnalysis(id, false)),
    );

    const payload = { recordingIds };
    const result = await this.queueService.enqueueTrainingAnalysis(
      TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_ALL,
      payload,
    );

    if (!result.queued) {
      void this.analysisProcessor
        .process(TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_ALL, payload)
        .catch((err: Error) => {
          this.logger.error(`Inline analyze-all failed: ${err.message}`);
        });

      return {
        queued: false,
        started: true,
        total: ids.length,
        message: 'Analysis started in background',
      };
    }

    return { queued: true, jobId: result.jobId, total: ids.length };
  }

  @Get('analysis')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'List all training call analyses' })
  listAnalyses() {
    return this.analysisService.listAnalyses();
  }

  @Post('recordings/:id/analyze')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Queue analysis for one training recording' })
  async analyzeRecording(@Param('id') id: string) {
    this.analysisService.assertEnabled();
    await this.analysisService.enqueueRecordingAnalysis(id, false);
    const payload = { recordingId: id, reanalyze: false };
    const result = await this.queueService.enqueueTrainingAnalysis(
      TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_CALL,
      payload,
    );

    if (!result.queued) {
      void this.analysisProcessor
        .process(TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_CALL, payload)
        .catch((err: Error) => {
          this.logger.error(`Inline analyze failed for ${id}: ${err.message}`);
        });

      return { queued: false, started: true, recordingId: id };
    }

    return { queued: true, jobId: result.jobId, recordingId: id };
  }

  @Post('recordings/:id/reanalyze')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Re-analyze a training recording' })
  async reanalyzeRecording(@Param('id') id: string) {
    this.analysisService.assertEnabled();
    await this.analysisService.enqueueRecordingAnalysis(id, true);
    const payload = { recordingId: id, reanalyze: true };
    const result = await this.queueService.enqueueTrainingAnalysis(
      TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_CALL,
      payload,
    );

    if (!result.queued) {
      void this.analysisProcessor
        .process(TRAINING_ANALYSIS_JOB_NAMES.ANALYZE_CALL, payload)
        .catch((err: Error) => {
          this.logger.error(`Inline reanalyze failed for ${id}: ${err.message}`);
        });

      return { queued: false, started: true, recordingId: id, reanalyze: true };
    }

    return { queued: true, jobId: result.jobId, recordingId: id, reanalyze: true };
  }

  @Get('recordings/:id/analysis')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'Get analysis for one training recording' })
  getAnalysis(@Param('id') id: string) {
    return this.analysisService.getAnalysisForRecording(id);
  }

  @Post('insights/generate')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Generate aggregate training insights report' })
  async generateInsights() {
    this.analysisService.assertEnabled();
    const result = await this.queueService.enqueueTrainingAnalysis(
      TRAINING_ANALYSIS_JOB_NAMES.AGGREGATE_INSIGHTS,
      {},
    );

    if (!result.queued) {
      return this.analysisProcessor.process(
        TRAINING_ANALYSIS_JOB_NAMES.AGGREGATE_INSIGHTS,
        {},
      );
    }

    return { queued: true, jobId: result.jobId };
  }

  @Get('insights/latest')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'Get latest aggregate training insights report' })
  getLatestInsights() {
    return this.analysisService.getLatestInsightReport();
  }
}
