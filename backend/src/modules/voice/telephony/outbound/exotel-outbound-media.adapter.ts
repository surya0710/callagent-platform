import { Injectable } from '@nestjs/common';
import { smartfloMulawBase64ToExotelPcm16Base64 } from '../exotel-media.util';
import { TelephonyProvider } from '../telephony-provider.types';
import {
  OutboundMediaBuildInput,
  OutboundMediaBuildResult,
  TelephonyOutboundMediaAdapter,
} from './telephony-outbound-media.types';

@Injectable()
export class ExotelOutboundMediaAdapter implements TelephonyOutboundMediaAdapter {
  readonly telephonyProvider = TelephonyProvider.EXOTEL;

  buildOutboundMedia(input: OutboundMediaBuildInput): OutboundMediaBuildResult {
    const decodedMulawBytes = Buffer.from(input.base64MulawPayload, 'base64').length;
    const exotelPayload = smartfloMulawBase64ToExotelPcm16Base64(
      input.base64MulawPayload,
    );

    return {
      telephonyProvider: this.telephonyProvider,
      decodedMulawBytes,
      message: JSON.stringify({
        event: 'media',
        stream_sid: input.streamSid,
        media: {
          payload: exotelPayload,
        },
      }),
    };
  }

  buildMarkMessage(streamSid: string, name: string): string {
    return JSON.stringify({
      event: 'mark',
      stream_sid: streamSid,
      mark: { name },
    });
  }

  buildClearMessage(streamSid: string): string {
    return JSON.stringify({
      event: 'clear',
      stream_sid: streamSid,
    });
  }
}
