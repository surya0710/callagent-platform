import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TelephonyMediaEncoding,
  TelephonyProvider,
} from './telephony-provider.types';

@Injectable()
export class TelephonyProviderConfigService {
  constructor(private readonly configService: ConfigService) {}

  getProvider(): TelephonyProvider {
    const raw = this.configService
      .get<string>('TELEPHONY_PROVIDER')
      ?.trim()
      .toLowerCase();

    if (raw === TelephonyProvider.EXOTEL) {
      return TelephonyProvider.EXOTEL;
    }

    return TelephonyProvider.SMARTFLO;
  }

  isExotel(): boolean {
    return this.getProvider() === TelephonyProvider.EXOTEL;
  }

  isSmartflo(): boolean {
    return this.getProvider() === TelephonyProvider.SMARTFLO;
  }

  getOutboundMediaEncoding(): TelephonyMediaEncoding {
    return this.isExotel() ? 'pcm16' : 'mulaw';
  }

  getExotelApiBaseUrl(): string {
    return (
      this.configService.get<string>('EXOTEL_API_BASE_URL')?.trim() ||
      'https://api.exotel.com'
    ).replace(/\/+$/, '');
  }

  getExotelAccountSid(): string | undefined {
    return this.configService.get<string>('EXOTEL_ACCOUNT_SID')?.trim();
  }

  getExotelApiKey(): string | undefined {
    return this.configService.get<string>('EXOTEL_API_KEY')?.trim();
  }

  getExotelApiToken(): string | undefined {
    return this.configService.get<string>('EXOTEL_API_TOKEN')?.trim();
  }

  getExotelCallerId(): string | undefined {
    return this.configService.get<string>('EXOTEL_CALLER_ID')?.trim();
  }

  getExotelConnectTo(): string | undefined {
    return (
      this.configService.get<string>('EXOTEL_CONNECT_TO')?.trim() ||
      this.getExotelCallerId()
    );
  }

  getExotelVoiceFlowUrl(): string | undefined {
    const raw = this.configService.get<string>('EXOTEL_VOICE_FLOW_URL')?.trim();
    return raw || undefined;
  }

  getExotelConnectUrl(): string {
    return (
      this.getExotelVoiceFlowUrl() ?? 'http://twimlets.com/holdmusic'
    );
  }
}
