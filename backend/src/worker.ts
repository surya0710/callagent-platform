import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { OnDemandCallProcessor } from './queues/processors/on-demand-call.processor';
import { CampaignCallProcessor } from './queues/processors/campaign-call.processor';
import { CallRetryProcessor } from './queues/processors/call-retry.processor';
import { SummaryProcessor } from './queues/processors/summary.processor';
import { QUEUE_NAMES } from './queues/queues.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('WorkerBootstrap');

  if (configService.get<string>('REDIS_ENABLED', 'true') === 'false') {
    logger.warn('REDIS_ENABLED=false — worker exiting (no queues to process)');
    await app.close();
    return;
  }

  const campaignCallProcessor = app.get(CampaignCallProcessor);
  const onDemandCallProcessor = app.get(OnDemandCallProcessor);
  const callRetryProcessor = app.get(CallRetryProcessor);
  const summaryProcessor = app.get(SummaryProcessor);

  const connection = {
    host: configService.getOrThrow<string>('REDIS_HOST'),
    port: configService.getOrThrow<number>('REDIS_PORT'),
  };

  const workers: Worker[] = [
    new Worker(
      QUEUE_NAMES.CAMPAIGN_CALLS,
      async (job) => campaignCallProcessor.process(job.data),
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.ON_DEMAND_CALLS,
      async (job) => onDemandCallProcessor.process(job.data),
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.CALL_RETRIES,
      async (job) => callRetryProcessor.process(job.data),
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.SUMMARIES,
      async (job) => summaryProcessor.process(job.data),
      { connection },
    ),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      logger.error(`Job ${job?.id} failed: ${err.message}`);
    });
    logger.log(`Worker listening on queue: ${worker.name}`);
  }

  logger.log('AI Voice worker started');
}

bootstrap().catch((error) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
