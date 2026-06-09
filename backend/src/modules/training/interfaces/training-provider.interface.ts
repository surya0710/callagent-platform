export interface TranscribeAudioInput {
  filePath: string;
  fileName: string;
  mimeType: string;
  language?: string;
}

export interface TranscribeAudioOutput {
  text: string;
  provider: string;
  model: string;
}

export interface UploadTrainingFileInput {
  filePath: string;
  fileName: string;
}

export interface UploadTrainingFileOutput {
  fileId: string;
  provider: string;
}

export interface StartFineTuneInput {
  trainingFileId: string;
  model: string;
  suffix?: string;
}

export interface FineTuneJobOutput {
  providerJobId: string;
  status: string;
  fineTunedModel?: string;
  errorMessage?: string;
}

export interface TrainingProvider {
  name: string;
  transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioOutput>;
  uploadTrainingFile(input: UploadTrainingFileInput): Promise<UploadTrainingFileOutput>;
  startFineTune(input: StartFineTuneInput): Promise<FineTuneJobOutput>;
  getFineTuneJob(jobId: string): Promise<FineTuneJobOutput>;
}
