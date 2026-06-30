import { Injectable } from '@nestjs/common';
import { TelephonyProvider } from '../telephony-provider.types';
import { ExotelOutboundMediaAdapter } from './exotel-outbound-media.adapter';
import { SmartfloOutboundMediaAdapter } from './smartflo-outbound-media.adapter';
import { TelephonyOutboundMediaAdapter } from './telephony-outbound-media.types';

@Injectable()
export class TelephonyOutboundMediaFactory {
  constructor(
    private readonly smartfloOutboundMediaAdapter: SmartfloOutboundMediaAdapter,
    private readonly exotelOutboundMediaAdapter: ExotelOutboundMediaAdapter,
  ) {}

  getAdapter(provider: TelephonyProvider): TelephonyOutboundMediaAdapter {
    if (provider === TelephonyProvider.EXOTEL) {
      return this.exotelOutboundMediaAdapter;
    }

    return this.smartfloOutboundMediaAdapter;
  }
}
