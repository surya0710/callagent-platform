import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BedrockTrainingProvider } from './providers/bedrock-training.provider';
import { MockTrainingProvider } from './providers/mock-training.provider';
import { OpenAiTrainingProvider } from './providers/openai-training.provider';
import { TrainingTranscriptPostProcessService } from './services/training-transcript-postprocess.service';
import { TrainingController } from './training.controller';
import { TrainingProviderFactory } from './training-provider.factory';
import { TrainingService } from './training.service';
import { TrainingTranscriptionConfigService } from './utils/training-transcription-config.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [TrainingController],
  providers: [
    TrainingService,
    TrainingProviderFactory,
    OpenAiTrainingProvider,
    BedrockTrainingProvider,
    MockTrainingProvider,
    TrainingTranscriptionConfigService,
    TrainingTranscriptPostProcessService,
  ],
})
export class TrainingModule {}
