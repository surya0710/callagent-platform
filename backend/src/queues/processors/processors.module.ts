import { Module } from '@nestjs/common';
import { CallsModule } from '../../modules/calls/calls.module';
import { CampaignCallProcessor } from './campaign-call.processor';
import { CallRetryProcessor } from './call-retry.processor';
import { SummaryProcessor } from './summary.processor';

@Module({
  imports: [CallsModule],
  providers: [CampaignCallProcessor, CallRetryProcessor, SummaryProcessor],
  exports: [CampaignCallProcessor, CallRetryProcessor, SummaryProcessor],
})
export class ProcessorsModule {}
