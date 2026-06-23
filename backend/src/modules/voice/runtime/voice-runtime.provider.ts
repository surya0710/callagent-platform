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

export interface VoiceRuntimeProvider {
  readonly name: string;

  onSocketConnected?(socketSessionId: string): void;
  createSession(context: VoiceRuntimeSessionContext): Promise<void>;
  handleAudio(streamSid: string, pcm16Audio: Buffer): void;
  endSession(streamSid: string): Promise<void>;
}
