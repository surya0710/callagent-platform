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

/** Normalize Exotel AgentStream snake_case fields to Smartflo camelCase shape. */
export function normalizeExotelStreamPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...payload };

  const topLevelStreamSid = readString(payload, 'stream_sid', 'streamSid');
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

  if (payload.event === 'stop') {
    const stop = asRecord(payload.stop) ?? {};
    normalized.stop = {
      ...stop,
      callSid: readString(stop, 'call_sid', 'callSid'),
      reason: typeof stop.reason === 'string' ? stop.reason : undefined,
    };
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
