import { Module } from '@nestjs/common';
import { CallsModule } from '../../modules/calls/calls.module';
import { VoiceModule } from '../../modules/voice/voice.module';
import { CampaignCallProcessor } from './campaign-call.processor';
import { CallRetryProcessor } from './call-retry.processor';
import { SummaryProcessor } from './summary.processor';
import { TranscriptEmailProcessor } from './transcript-email.processor';
import { TranscriptProcessor } from './transcript.processor';

@Module({
  imports: [CallsModule, VoiceModule],
  providers: [
    CampaignCallProcessor,
    CallRetryProcessor,
    SummaryProcessor,
    TranscriptEmailProcessor,
    TranscriptProcessor,
  ],
  exports: [
    CampaignCallProcessor,
    CallRetryProcessor,
    SummaryProcessor,
    TranscriptEmailProcessor,
    TranscriptProcessor,
  ],
})
export class ProcessorsModule {}
