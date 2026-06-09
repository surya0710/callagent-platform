import { Injectable, NotImplementedException } from '@nestjs/common';
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
export class BedrockTrainingProvider implements TrainingProvider {
  readonly name = 'bedrock';

  async transcribeAudio(_input: TranscribeAudioInput): Promise<TranscribeAudioOutput> {
    throw new NotImplementedException('Bedrock training transcription is not implemented yet.');
  }

  async uploadTrainingFile(_input: UploadTrainingFileInput): Promise<UploadTrainingFileOutput> {
    throw new NotImplementedException('Bedrock training file upload is not implemented yet.');
  }

  async startFineTune(_input: StartFineTuneInput): Promise<FineTuneJobOutput> {
    throw new NotImplementedException('Bedrock fine-tuning is not implemented yet.');
  }

  async getFineTuneJob(_jobId: string): Promise<FineTuneJobOutput> {
    throw new NotImplementedException('Bedrock fine-tune status is not implemented yet.');
  }
}
