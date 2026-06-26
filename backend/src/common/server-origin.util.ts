import { hostname } from 'node:os';
import { TelephonyProvider } from '../modules/voice/telephony/telephony-provider.types';

const DEFAULT_SMARTFLO_BASE_URL = 'https://api-smartflo.tatateleservices.com';
const DEFAULT_EXOTEL_BASE_URL = 'https://api.exotel.com';
const DEFAULT_VOICE_WSS_BASE_URL = 'wss://tatdai.in/api/voice/stream';

export interface ServerOriginInfo {
  hostname: string;
  serverId: string | null;
  environment: string | null;
  appVersion: string | null;
  telephonyProvider: TelephonyProvider;
  smartfloApiBaseUrl: string;
  exotelApiBaseUrl: string;
  voiceWssBaseUrl: string;
}

export interface CallRequestOriginInfo extends ServerOriginInfo {
  smartfloRequestUrl: string;
  exotelRequestUrl?: string;
  requestedByIp?: string;
  requestedByForwardedFor?: string;
}

export function buildServerOriginInfo(config: {
  nodeEnv?: string;
  appVersion?: string;
  serverId?: string;
  smartfloBaseUrl?: string;
  exotelBaseUrl?: string;
  telephonyProvider?: TelephonyProvider;
  voiceWssBaseUrl?: string;
}): ServerOriginInfo {
  const telephonyProvider =
    config.telephonyProvider === TelephonyProvider.EXOTEL
      ? TelephonyProvider.EXOTEL
      : TelephonyProvider.SMARTFLO;

  return {
    hostname: hostname(),
    serverId: config.serverId?.trim() || null,
    environment: config.nodeEnv?.trim() || null,
    appVersion: config.appVersion?.trim() || null,
    telephonyProvider,
    smartfloApiBaseUrl:
      config.smartfloBaseUrl?.trim() || DEFAULT_SMARTFLO_BASE_URL,
    exotelApiBaseUrl: config.exotelBaseUrl?.trim() || DEFAULT_EXOTEL_BASE_URL,
    voiceWssBaseUrl:
      config.voiceWssBaseUrl?.trim() || DEFAULT_VOICE_WSS_BASE_URL,
  };
}

export function buildCallRequestOriginInfo(
  config: Parameters<typeof buildServerOriginInfo>[0] & {
    smartfloRequestPath?: string;
    exotelAccountSid?: string;
    requestedByIp?: string;
    requestedByForwardedFor?: string;
  },
): CallRequestOriginInfo {
  const origin = buildServerOriginInfo(config);
  const smartfloBase = origin.smartfloApiBaseUrl.replace(/\/+$/, '');
  const path = config.smartfloRequestPath ?? '/v1/click_to_call_support';
  const accountSid = config.exotelAccountSid?.trim();
  const exotelBase = origin.exotelApiBaseUrl.replace(/\/+$/, '');

  return {
    ...origin,
    smartfloRequestUrl: `${smartfloBase}${path}`,
    exotelRequestUrl: accountSid
      ? `${exotelBase}/v1/Accounts/${accountSid}/Calls/connect.json`
      : undefined,
    requestedByIp: config.requestedByIp,
    requestedByForwardedFor: config.requestedByForwardedFor,
  };
}
