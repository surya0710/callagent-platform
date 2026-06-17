import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queues.module';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @InjectQueue(QUEUE_NAMES.CAMPAIGN_CALLS) private readonly campaignCallsQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.ON_DEMAND_CALLS) private readonly onDemandCallsQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.CALL_RETRIES) private readonly callRetriesQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.SUMMARIES) private readonly summariesQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.TRANSCRIPTS) private readonly transcriptsQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.TRAINING_ANALYSIS) private readonly trainingAnalysisQueue?: Queue,
  ) {
    this.enabled = configService.get<string>('REDIS_ENABLED', 'true') === 'true';
  }

  async enqueueCampaignCall(payload: Record<string, unknown>) {
    if (!this.enabled || !this.campaignCallsQueue) {
      this.logger.warn('Redis disabled — campaign call job logged only');
      return { queued: false, payload };
    }

    const job = await this.campaignCallsQueue.add('dial', payload);
    return { queued: true, jobId: job.id };
  }

  async enqueueOnDemandCall(payload: Record<string, unknown>) {
    if (!this.enabled || !this.onDemandCallsQueue) {
      this.logger.warn('Redis disabled — on-demand call job processed inline');
      return { queued: false, payload };
    }

    const job = await this.onDemandCallsQueue.add('dial', payload, {
      priority: payload.priority === 'high' ? 1 : 5,
    });
    return { queued: true, jobId: job.id };
  }

  async enqueueCallRetry(payload: Record<string, unknown>) {
    if (!this.enabled || !this.callRetriesQueue) {
      this.logger.warn('Redis disabled — call retry job logged only');
      return { queued: false, payload };
    }

    const job = await this.callRetriesQueue.add('retry', payload);
    return { queued: true, jobId: job.id };
  }

  async enqueueSummary(payload: Record<string, unknown>) {
    if (!this.enabled || !this.summariesQueue) {
      this.logger.warn('Redis disabled — summary job logged only');
      return { queued: false, payload };
    }

    const job = await this.summariesQueue.add('summarize', payload);
    return { queued: true, jobId: job.id };
  }

  async enqueueTranscript(payload: Record<string, unknown>) {
    if (!this.enabled || !this.transcriptsQueue) {
      this.logger.warn('Redis disabled — transcript job logged only');
      return { queued: false, payload };
    }

    const job = await this.transcriptsQueue.add('transcribe', payload);
    return { queued: true, jobId: job.id };
  }

  async enqueueTrainingAnalysis(jobName: string, payload: Record<string, unknown>) {
    if (!this.enabled || !this.trainingAnalysisQueue) {
      this.logger.warn('Redis disabled — training analysis job processed inline');
      return { queued: false, payload, jobName };
    }

    const job = await this.trainingAnalysisQueue.add(jobName, payload);
    return { queued: true, jobId: job.id };
  }
}
