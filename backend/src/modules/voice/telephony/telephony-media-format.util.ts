import { TelephonyMediaEncoding, TelephonyProvider } from './telephony-provider.types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Resolve wire encoding from Exotel/Smartflo start.mediaFormat.
 * Exotel often reports encoding "base64" with bit_rate "128kbps" while sending
 * 8 kHz mulaw-sized payloads (~320–800 bytes/chunk, ~64 kbps).
 */
export function resolveTelephonyMediaEncoding(
  mediaFormat: unknown,
  provider: TelephonyProvider,
): TelephonyMediaEncoding {
  const fmt = asRecord(mediaFormat);
  if (fmt) {
    const encoding = readString(fmt.encoding);
    const bitRate = readString(fmt.bit_rate ?? fmt.bitRate).replace(/\s+/g, '');

    if (
      encoding.includes('mulaw') ||
      encoding.includes('mu-law') ||
      encoding.includes('x-mulaw') ||
      encoding.includes('pcmu')
    ) {
      return 'mulaw';
    }

    if (
      encoding.includes('raw') ||
      encoding.includes('pcm') ||
      encoding.includes('l16') ||
      encoding.includes('linear') ||
      encoding.includes('slin')
    ) {
      return 'pcm16';
    }

    if (bitRate.includes('64')) {
      return 'mulaw';
    }

    if (bitRate.includes('128')) {
      return 'pcm16';
    }

    // Ambiguous Exotel metadata (observed: encoding=base64, ~428-byte media chunks).
    if (provider === TelephonyProvider.EXOTEL && encoding === 'base64') {
      return 'mulaw';
    }
  }

  if (provider === TelephonyProvider.EXOTEL) {
    return 'pcm16';
  }

  return 'mulaw';
}
