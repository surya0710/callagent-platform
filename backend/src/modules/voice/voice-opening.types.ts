export interface VoiceOpeningContext {
  agentName: string;
  companyName: string;
  callPurpose: string;
  openingGreeting?: string;
  askPermissionBeforePitch?: boolean;
}

export interface VoiceOpeningRuntimeState {
  openingContext?: VoiceOpeningContext;
  openingGreetingRequestedAt?: Date;
  openingGreetingResponseCreatedAt?: Date;
  openingGreetingError?: string;
}
