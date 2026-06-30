import { Injectable } from '@nestjs/common';
import { extractSmartfloProviderCallSid } from '../../voice-call-authorization.service';

/**
 * Extract provider call SID from Exotel connect API JSON responses.
 */
export function extractExotelProviderCallSid(providerResponse: unknown): string | undefined {
  if (!providerResponse || typeof providerResponse !== 'object') {
    return undefined;
  }

  const root = providerResponse as Record<string, unknown>;
  const call = root.Call;
  if (call && typeof call === 'object') {
    const sid = (call as Record<string, unknown>).Sid;
    if (typeof sid === 'string' && sid.trim().length > 0) {
      return sid.trim();
    }
  }

  return extractSmartfloProviderCallSid(providerResponse);
}
