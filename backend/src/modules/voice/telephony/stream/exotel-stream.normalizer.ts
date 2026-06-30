import { encodePcm16ToMulaw } from '../../audio/mulaw-codec';
import {
  EXOTEL_PCM16_FRAME_BYTES,
  isLikelyExotelPcm16Payload,
  padExotelPcm16Buffer,
} from '../exotel-media.util';
import { VoiceStreamStartData } from '../../stream/voice-stream.types';

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
  if (typeof snake === 'string' && snake.trim().length > 0) {
    return snake.trim();
  }

  const camel = record[camelKey];
  if (typeof camel === 'string' && camel.trim().length > 0) {
    return camel.trim();
  }

  return undefined;
}

function readStreamSid(payload: Record<string, unknown>): string | undefined {
  return readString(payload, 'stream_sid', 'streamSid');
}

function normalizeCustomParameters(raw: unknown): unknown {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Object.fromEntries(new URLSearchParams(raw.trim()));
    return Object.keys(parsed).length > 0 ? parsed : raw;
  }

  return raw;
}

function readCallSidFromCustomParameters(
  customParameters: unknown,
): string | undefined {
  const record =
    typeof customParameters === 'string'
      ? Object.fromEntries(new URLSearchParams(customParameters.trim()))
      : customParameters && typeof customParameters === 'object'
        ? (customParameters as Record<string, unknown>)
        : undefined;

  if (!record) {
    return undefined;
  }

  for (const key of ['callSid', 'call_sid', 'CallSid']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function extractExotelStreamSid(
  payload: Record<string, unknown>,
  start: Record<string, unknown>,
): string | undefined {
  return (
    readString(start, 'stream_sid', 'streamSid') ??
    readStreamSid(payload) ??
    readString(start, 'call_sid', 'callSid') ??
    readString(payload, 'call_sid', 'callSid')
  );
}

export function extractExotelCallSid(
  payload: Record<string, unknown>,
  start: Record<string, unknown>,
): string | undefined {
  const normalizedCustom =
    normalizeCustomParameters(start.customParameters ?? start.custom_parameters) ??
    normalizeCustomParameters(
      payload.custom_parameters ?? payload.customParameters,
    );

  return (
    readString(start, 'call_sid', 'callSid') ??
    readString(payload, 'call_sid', 'callSid') ??
    readCallSidFromCustomParameters(normalizedCustom)
  );
}

export interface ExotelNormalizedStart {
  event: 'start';
  streamSid: string;
  start: VoiceStreamStartData;
}

export interface ExotelNormalizedMedia {
  event: 'media';
  streamSid: string;
  pcm16Audio: Buffer;
  recordingInboundMulawBase64?: string;
  payloadByteLength: number;
}

export interface ExotelNormalizedStop {
  event: 'stop';
  streamSid: string;
  callSid?: string;
  reason?: string;
}

export type ExotelNormalizedStreamEvent =
  | { event: 'connected' }
  | ExotelNormalizedStart
  | ExotelNormalizedMedia
  | ExotelNormalizedStop
  | { event: 'dtmf' | 'mark' | 'clear'; streamSid?: string; raw: Record<string, unknown> }
  | { event: 'unknown'; raw: Record<string, unknown> };

export function normalizeExotelStreamEvent(
  payload: Record<string, unknown>,
): ExotelNormalizedStreamEvent {
  const event = payload.event;
  if (typeof event !== 'string') {
    return { event: 'unknown', raw: payload };
  }

  const topLevelStreamSid = readStreamSid(payload);

  switch (event) {
    case 'connected':
      return { event: 'connected' };

    case 'start': {
      const start = asRecord(payload.start) ?? {};
      const streamSid = extractExotelStreamSid(payload, start) ?? '';
      const callSid = extractExotelCallSid(payload, start);

      return {
        event: 'start',
        streamSid,
        start: {
          streamSid,
          callSid,
          accountSid: readString(start, 'account_sid', 'accountSid'),
          from: typeof start.from === 'string' ? start.from : undefined,
          to: typeof start.to === 'string' ? start.to : undefined,
          direction:
            typeof start.direction === 'string' ? start.direction : undefined,
          mediaFormat: start.mediaFormat ?? start.media_format,
          customParameters: normalizeCustomParameters(
            start.customParameters ?? start.custom_parameters,
          ),
        },
      };
    }

    case 'media': {
      const streamSid = topLevelStreamSid;
      const media = asRecord(payload.media) ?? {};
      const rawPayload =
        typeof media.payload === 'string' && media.payload.length > 0
          ? media.payload
          : undefined;

      if (!streamSid || !rawPayload) {
        return {
          event: 'media',
          streamSid: streamSid ?? '',
          pcm16Audio: Buffer.alloc(0),
          payloadByteLength: 0,
        };
      }

      const decoded = Buffer.from(rawPayload, 'base64');
      const pcm16Audio = decodeExotelInboundToPcm16(decoded);
      const recordingInboundMulawBase64 =
        pcm16Audio.length > 0
          ? encodePcm16ToMulaw(pcm16Audio).toString('base64')
          : undefined;

      return {
        event: 'media',
        streamSid,
        pcm16Audio,
        recordingInboundMulawBase64,
        payloadByteLength: decoded.length,
      };
    }

    case 'stop': {
      const stop = asRecord(payload.stop) ?? {};
      const streamSid = topLevelStreamSid ?? '';
      return {
        event: 'stop',
        streamSid,
        callSid: readString(stop, 'call_sid', 'callSid'),
        reason: typeof stop.reason === 'string' ? stop.reason : undefined,
      };
    }

    case 'dtmf':
    case 'mark':
    case 'clear':
      return {
        event,
        streamSid: topLevelStreamSid,
        raw: payload,
      };

    default:
      return { event: 'unknown', raw: payload };
  }
}

export function decodeExotelInboundToPcm16(decoded: Buffer): Buffer {
  if (decoded.length === 0) {
    return decoded;
  }

  if (isLikelyExotelPcm16Payload(decoded)) {
    return padExotelPcm16Buffer(decoded, EXOTEL_PCM16_FRAME_BYTES);
  }

  return decoded;
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
