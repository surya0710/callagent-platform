import { TelephonyProvider } from '../telephony-provider.types';

export interface OutboundMediaBuildInput {
  streamSid: string;
  base64MulawPayload: string;
  chunk?: number;
  sequenceNumber?: number;
  timestamp?: number;
}

export interface OutboundMediaBuildResult {
  telephonyProvider: TelephonyProvider;
  message: string;
  decodedMulawBytes: number;
}

export interface TelephonyOutboundMediaAdapter {
  readonly telephonyProvider: TelephonyProvider;
  buildOutboundMedia(input: OutboundMediaBuildInput): OutboundMediaBuildResult;
  buildMarkMessage(streamSid: string, name: string): string;
  buildClearMessage(streamSid: string): string;
}
