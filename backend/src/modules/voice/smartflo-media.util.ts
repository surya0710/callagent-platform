function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

export interface ParsedSmartfloInboundMedia {
  payloadBase64?: string;
  track?: string;
  chunk?: string;
  timestamp?: string;
  payloadByteLength?: number;
  parseSource: 'media.payload' | 'payload' | 'none';
}

export function parseSmartfloInboundMedia(
  payload: Record<string, unknown>,
): ParsedSmartfloInboundMedia {
  const media = asRecord(payload.media);
  const track =
    media && typeof media.track === 'string' ? media.track : undefined;

  if (media && typeof media.payload === 'string' && media.payload.length > 0) {
    return {
      payloadBase64: media.payload,
      track,
      chunk:
        media.chunk !== undefined && media.chunk !== null
          ? String(media.chunk)
          : undefined,
      timestamp:
        media.timestamp !== undefined && media.timestamp !== null
          ? String(media.timestamp)
          : undefined,
      payloadByteLength: Buffer.from(media.payload, 'base64').length,
      parseSource: 'media.payload',
    };
  }

  if (typeof payload.payload === 'string' && payload.payload.length > 0) {
    return {
      payloadBase64: payload.payload,
      track,
      payloadByteLength: Buffer.from(payload.payload, 'base64').length,
      parseSource: 'payload',
    };
  }

  return {
    track,
    parseSource: 'none',
  };
}
