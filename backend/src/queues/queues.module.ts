import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';

export const QUEUE_NAMES = {
  CAMPAIGN_CALLS: 'campaign-calls',
  ON_DEMAND_CALLS: 'on-demand-calls',
  CALL_RETRIES: 'call-retries',
  SUMMARIES: 'summaries',
  TRANSCRIPTS: 'transcripts',
} as const;

@Module({})
export class QueuesModule {
  static forRoot(): DynamicModule {
    const redisEnabled = process.env.REDIS_ENABLED !== 'false';

    const bullImports = redisEnabled
      ? [
          BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
              connection: {
                host: configService.getOrThrow<string>('REDIS_HOST'),
                port: configService.getOrThrow<number>('REDIS_PORT'),
              },
            }),
          }),
          BullModule.registerQueue(
            { name: QUEUE_NAMES.CAMPAIGN_CALLS },
            { name: QUEUE_NAMES.ON_DEMAND_CALLS },
            { name: QUEUE_NAMES.CALL_RETRIES },
            { name: QUEUE_NAMES.SUMMARIES },
            { name: QUEUE_NAMES.TRANSCRIPTS },
          ),
        ]
      : [];

    return {
      module: QueuesModule,
      imports: bullImports,
      providers: [QueueService],
      exports: redisEnabled ? [BullModule, QueueService] : [QueueService],
      global: true,
    };
  }
}
