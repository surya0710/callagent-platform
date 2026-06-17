import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BedrockTrainingProvider } from './providers/bedrock-training.provider';
import { MockTrainingProvider } from './providers/mock-training.provider';
import { OpenAiTrainingProvider } from './providers/openai-training.provider';
import { TrainingTranscriptPostProcessService } from './services/training-transcript-postprocess.service';
import { TrainingCallAnalysisController } from './training-call-analysis.controller';
import { TrainingCallAnalysisProcessor } from './training-call-analysis.processor';
import { TrainingCallAnalysisService } from './training-call-analysis.service';
import { TrainingController } from './training.controller';
import { TrainingProviderFactory } from './training-provider.factory';
import { TrainingService } from './training.service';
import { TrainingCallAnalysisConfigService } from './utils/training-call-analysis-config.service';
import { TrainingTranscriptionConfigService } from './utils/training-transcription-config.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [TrainingController, TrainingCallAnalysisController],
  providers: [
    TrainingService,
    TrainingCallAnalysisService,
    TrainingCallAnalysisProcessor,
    TrainingCallAnalysisConfigService,
    TrainingProviderFactory,
    OpenAiTrainingProvider,
    BedrockTrainingProvider,
    MockTrainingProvider,
    TrainingTranscriptionConfigService,
    TrainingTranscriptPostProcessService,
  ],
  exports: [TrainingCallAnalysisProcessor, TrainingCallAnalysisService],
})
export class TrainingModule {}
