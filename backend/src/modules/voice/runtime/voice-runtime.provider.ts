import { VoiceOpeningContext } from '../voice-opening.types';
import { CallContext } from '../voice-call-context.types';

export type VoiceRuntimeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export interface VoiceRuntimeSessionContext {
  streamSid: string;
  socketSessionId?: string;
  callSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  openingContext?: VoiceOpeningContext;
  callContext?: CallContext;
  aiSpeakFirstEnabled?: boolean;
  smartfloStartReceived?: boolean;
  authorized?: boolean;
}

/** Connect OpenAI while the outbound call is still ringing (before Smartflo start). */
export interface VoiceRuntimePrewarmContext {
  callSid?: string;
  customerNumber?: string;
  callId?: string;
  openingContext?: VoiceOpeningContext;
  callContext?: CallContext;
  aiSpeakFirstEnabled: boolean;
}

export interface VoiceRuntimeProvider {
  readonly name: string;

  onSocketConnected?(socketSessionId: string): void;
  prewarmAuthorizedCall?(input: VoiceRuntimePrewarmContext): void;
  createSession(context: VoiceRuntimeSessionContext): Promise<void>;
  handleAudio(streamSid: string, pcm16Audio: Buffer): void;
  endSession(streamSid: string): Promise<void>;
}
