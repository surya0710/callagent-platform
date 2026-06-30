import { TelephonyProvider } from '../telephony/telephony-provider.types';

export interface VoiceStreamStartData {
  streamSid: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
}

export interface VoiceStreamProviderContext {
  telephonyProvider: TelephonyProvider;
  socketSessionId: string;
}
