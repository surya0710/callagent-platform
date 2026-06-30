import { IncomingMessage } from 'http';
import { TelephonyProvider } from './telephony/telephony-provider.types';

export type VoiceStreamProvider = TelephonyProvider;

export interface VoiceStreamQueryParams {
  provider?: VoiceStreamProvider;
  authorizationId?: string;
  callSid?: string;
}

function readVoiceStreamSearchParams(
  request: IncomingMessage,
): URLSearchParams | undefined {
  const rawUrl = request.url?.trim();
  if (!rawUrl) {
    return undefined;
  }

  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex < 0) {
    return undefined;
  }

  return new URLSearchParams(rawUrl.slice(queryIndex + 1));
}

export function parseVoiceStreamQueryFromRequest(
  request: IncomingMessage,
): VoiceStreamQueryParams {
  const params = readVoiceStreamSearchParams(request);
  if (!params) {
    return {};
  }

  const provider = params.get('provider')?.trim().toLowerCase();
  const authorizationId =
    params.get('authorizationId')?.trim() ||
    params.get('authorization_id')?.trim() ||
    undefined;
  const callSid =
    params.get('CallSid')?.trim() ||
    params.get('callSid')?.trim() ||
    params.get('call_sid')?.trim() ||
    undefined;

  const resolvedProvider =
    provider === TelephonyProvider.EXOTEL
      ? TelephonyProvider.EXOTEL
      : provider === TelephonyProvider.SMARTFLO
        ? TelephonyProvider.SMARTFLO
        : undefined;

  return {
    provider: resolvedProvider,
    authorizationId,
    callSid,
  };
}

export function parseVoiceStreamProviderFromRequest(
  request: IncomingMessage,
): VoiceStreamProvider | undefined {
  return parseVoiceStreamQueryFromRequest(request).provider;
}

export function parseVoiceStreamAuthorizationIdFromRequest(
  request: IncomingMessage,
): string | undefined {
  return parseVoiceStreamQueryFromRequest(request).authorizationId;
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
