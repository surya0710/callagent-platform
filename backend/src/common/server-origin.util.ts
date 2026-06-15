import { hostname } from 'node:os';

const DEFAULT_SMARTFLO_BASE_URL = 'https://api-smartflo.tatateleservices.com';
const DEFAULT_VOICE_WSS_BASE_URL = 'wss://tatdai.in/api/voice/stream';

export interface ServerOriginInfo {
  hostname: string;
  serverId: string | null;
  environment: string | null;
  appVersion: string | null;
  smartfloApiBaseUrl: string;
  voiceWssBaseUrl: string;
}

export interface CallRequestOriginInfo extends ServerOriginInfo {
  smartfloRequestUrl: string;
  requestedByIp?: string;
  requestedByForwardedFor?: string;
}

export function buildServerOriginInfo(config: {
  nodeEnv?: string;
  appVersion?: string;
  serverId?: string;
  smartfloBaseUrl?: string;
  voiceWssBaseUrl?: string;
}): ServerOriginInfo {
  return {
    hostname: hostname(),
    serverId: config.serverId?.trim() || null,
    environment: config.nodeEnv?.trim() || null,
    appVersion: config.appVersion?.trim() || null,
    smartfloApiBaseUrl:
      config.smartfloBaseUrl?.trim() || DEFAULT_SMARTFLO_BASE_URL,
    voiceWssBaseUrl:
      config.voiceWssBaseUrl?.trim() || DEFAULT_VOICE_WSS_BASE_URL,
  };
}

export function buildCallRequestOriginInfo(
  config: Parameters<typeof buildServerOriginInfo>[0] & {
    smartfloRequestPath?: string;
    requestedByIp?: string;
    requestedByForwardedFor?: string;
  },
): CallRequestOriginInfo {
  const origin = buildServerOriginInfo(config);
  const base = origin.smartfloApiBaseUrl.replace(/\/+$/, '');
  const path = config.smartfloRequestPath ?? '/v1/click_to_call_support';

  return {
    ...origin,
    smartfloRequestUrl: `${base}${path}`,
    requestedByIp: config.requestedByIp,
    requestedByForwardedFor: config.requestedByForwardedFor,
  };
}
