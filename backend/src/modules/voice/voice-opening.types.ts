export interface VoiceOpeningContext {
  agentName: string;
  companyName: string;
  callPurpose: string;
  openingGreeting?: string;
  askPermissionBeforePitch?: boolean;
}

export type OpeningState =
  | 'disabled'
  | 'waiting_for_smartflo_start'
  | 'waiting_for_openai_ready'
  | 'ready_to_speak'
  | 'opening_response_requested'
  | 'opening_audio_playing'
  | 'opening_done'
  | 'failed';

export interface VoiceOpeningRuntimeState {
  aiSpeakFirstEnabled?: boolean;
  openingState?: OpeningState;
  openingContext?: VoiceOpeningContext;
  openingRequestedAt?: Date;
  openingResponseCreatedAt?: Date;
  openingAudioStartedAt?: Date;
  openingAudioDoneAt?: Date;
  openingDoneAt?: Date;
  openingError?: string;
  normalModeActivatedAt?: Date;
  openingSuppressedInboundPackets?: number;
  postOpeningIgnoreUntil?: Date;
  /** @deprecated use openingRequestedAt */
  openingGreetingRequestedAt?: Date;
  /** @deprecated use openingResponseCreatedAt */
  openingGreetingResponseCreatedAt?: Date;
  /** @deprecated use openingError */
  openingGreetingError?: string;
}
