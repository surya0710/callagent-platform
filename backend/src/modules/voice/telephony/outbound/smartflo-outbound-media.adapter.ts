import { Injectable } from '@nestjs/common';
import { TelephonyProvider } from '../telephony-provider.types';
import {
  OutboundMediaBuildInput,
  OutboundMediaBuildResult,
  TelephonyOutboundMediaAdapter,
} from './telephony-outbound-media.types';

@Injectable()
export class SmartfloOutboundMediaAdapter implements TelephonyOutboundMediaAdapter {
  readonly telephonyProvider = TelephonyProvider.SMARTFLO;

  buildOutboundMedia(input: OutboundMediaBuildInput): OutboundMediaBuildResult {
    const decodedMulawBytes = Buffer.from(input.base64MulawPayload, 'base64').length;

    return {
      telephonyProvider: this.telephonyProvider,
      decodedMulawBytes,
      message: JSON.stringify({
        event: 'media',
        streamSid: input.streamSid,
        sequenceNumber: input.sequenceNumber,
        media: {
          payload: input.base64MulawPayload,
          chunk: String(input.chunk ?? 1),
          timestamp: String(input.timestamp ?? 0),
        },
      }),
    };
  }

  buildMarkMessage(streamSid: string, name: string): string {
    return JSON.stringify({
      event: 'mark',
      streamSid,
      mark: { name },
    });
  }

  buildClearMessage(streamSid: string): string {
    return JSON.stringify({
      event: 'clear',
      streamSid,
    });
  }
}
