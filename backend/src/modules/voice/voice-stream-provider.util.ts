import { IncomingMessage } from 'http';
import { TelephonyProvider } from './telephony/telephony-provider.types';

export type VoiceStreamProvider = TelephonyProvider;

export function parseVoiceStreamProviderFromRequest(
  request: IncomingMessage,
): VoiceStreamProvider | undefined {
  const rawUrl = request.url?.trim();
  if (!rawUrl) {
    return undefined;
  }

  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex < 0) {
    return undefined;
  }

  const search = rawUrl.slice(queryIndex + 1);
  const params = new URLSearchParams(search);
  const provider = params.get('provider')?.trim().toLowerCase();

  if (provider === TelephonyProvider.EXOTEL) {
    return TelephonyProvider.EXOTEL;
  }

  if (provider === TelephonyProvider.SMARTFLO) {
    return TelephonyProvider.SMARTFLO;
  }

  return undefined;
}

export function appendVoiceStreamProviderQuery(
  baseUrl: string,
  provider: VoiceStreamProvider,
): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (provider !== TelephonyProvider.EXOTEL) {
    return trimmed;
  }

  if (trimmed.includes('provider=exotel')) {
    return trimmed;
  }

  const separator = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${separator}provider=exotel`;
}
