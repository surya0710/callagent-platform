import { exotelInboundBase64ToSmartfloMulawBase64 } from './telephony/exotel-media.util';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  snakeKey: string,
  camelKey: string,
): string | undefined {
  if (!record) {
    return undefined;
  }

  const snake = record[snakeKey];
  if (typeof snake === 'string' && snake.length > 0) {
    return snake;
  }

  const camel = record[camelKey];
  if (typeof camel === 'string' && camel.length > 0) {
    return camel;
  }

  return undefined;
}

function readStreamSid(payload: Record<string, unknown>): string | undefined {
  return readString(payload, 'stream_sid', 'streamSid');
}

/**
 * Normalize Exotel AgentStream snake_case fields to Smartflo camelCase shape and
 * transcode inbound PCM16 audio to μ-law for the unchanged Smartflo runtime path.
 */
export function normalizeExotelStreamPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...payload };
  const topLevelStreamSid = readStreamSid(payload);

  if (topLevelStreamSid) {
    normalized.streamSid = topLevelStreamSid;
  }

  if (payload.event === 'start') {
    const start = asRecord(payload.start) ?? {};
    normalized.start = {
      ...start,
      streamSid: readString(start, 'stream_sid', 'streamSid') ?? topLevelStreamSid,
      callSid: readString(start, 'call_sid', 'callSid'),
      accountSid: readString(start, 'account_sid', 'accountSid'),
      from: typeof start.from === 'string' ? start.from : undefined,
      to: typeof start.to === 'string' ? start.to : undefined,
      direction:
        typeof start.direction === 'string' ? start.direction : undefined,
      mediaFormat: start.mediaFormat ?? start.media_format,
      customParameters: start.customParameters ?? start.custom_parameters,
    };
  }

  if (payload.event === 'media') {
    const media = asRecord(payload.media) ?? {};
    const rawPayload =
      typeof media.payload === 'string' && media.payload.length > 0
        ? media.payload
        : undefined;

    normalized.streamSid = topLevelStreamSid ?? normalized.streamSid;
    normalized.media = {
      ...media,
      ...(rawPayload
        ? { payload: exotelInboundBase64ToSmartfloMulawBase64(rawPayload) }
        : {}),
      chunk:
        media.chunk !== undefined && media.chunk !== null
          ? String(media.chunk)
          : undefined,
      timestamp:
        media.timestamp !== undefined && media.timestamp !== null
          ? String(media.timestamp)
          : undefined,
    };
  }

  if (payload.event === 'stop') {
    const stop = asRecord(payload.stop) ?? {};
    normalized.stop = {
      ...stop,
      callSid: readString(stop, 'call_sid', 'callSid'),
      reason: typeof stop.reason === 'string' ? stop.reason : undefined,
    };
    if (topLevelStreamSid) {
      normalized.streamSid = topLevelStreamSid;
    }
  }

  if (payload.event === 'mark' || payload.event === 'clear' || payload.event === 'dtmf') {
    if (topLevelStreamSid) {
      normalized.streamSid = topLevelStreamSid;
    }
  }

  return normalized;
}

export function readExotelMediaPayloadBytes(
  payload: Record<string, unknown>,
): number {
  const media = asRecord(payload.media);
  if (media && typeof media.payload === 'string' && media.payload.length > 0) {
    return Buffer.from(media.payload, 'base64').length;
  }

  return 0;
}
