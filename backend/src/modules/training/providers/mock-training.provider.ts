import { Injectable } from '@nestjs/common';
import {
  FineTuneJobOutput,
  StartFineTuneInput,
  TrainingProvider,
  TranscribeAudioInput,
  TranscribeAudioOutput,
  UploadTrainingFileInput,
  UploadTrainingFileOutput,
} from '../interfaces/training-provider.interface';

@Injectable()
export class MockTrainingProvider implements TrainingProvider {
  readonly name = 'mock';

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioOutput> {
    return {
      text: `[mock transcript] ${input.fileName} was uploaded for training. Replace this transcript with reviewed call text before fine-tuning.`,
      provider: this.name,
      model: 'mock-transcriber',
    };
  }

  async uploadTrainingFile(input: UploadTrainingFileInput): Promise<UploadTrainingFileOutput> {
    return {
      fileId: `mock-file-${input.fileName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
      provider: this.name,
    };
  }

  async startFineTune(input: StartFineTuneInput): Promise<FineTuneJobOutput> {
    return {
      providerJobId: `mock-ft-${Date.now()}`,
      status: 'queued',
      fineTunedModel: `ft:${input.model}:mock`,
    };
  }

  async getFineTuneJob(jobId: string): Promise<FineTuneJobOutput> {
    return {
      providerJobId: jobId,
      status: 'succeeded',
      fineTunedModel: `ft:mock:${jobId}`,
    };
  }
}
