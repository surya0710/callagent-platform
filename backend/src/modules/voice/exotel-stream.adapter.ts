import { Injectable, Logger } from '@nestjs/common';
import {
  normalizeExotelStreamPayload,
  readExotelMediaPayloadBytes,
} from './exotel-stream-payload.util';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { VoiceSocketRegistry } from './voice-socket.registry';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

@Injectable()
export class ExotelStreamAdapter {
  private readonly logger = new Logger(ExotelStreamAdapter.name);
  private readonly loggedFirstMediaBySocket = new Set<string>();

  constructor(
    private readonly smartfloStreamAdapter: SmartfloStreamAdapter,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
  ) {}

  handleMessage(socketSessionId: string, raw: string): void {
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.logger.warn({
        socketSessionId,
        message: 'Invalid JSON in Exotel WebSocket message',
      });
      return;
    }

    const event = payload.event;
    if (typeof event !== 'string') {
      this.logger.warn({
        socketSessionId,
        message: 'Missing or invalid event field in Exotel WebSocket message',
      });
      return;
    }

    switch (event) {
      case 'connected':
        this.logger.log({
          socketSessionId,
          message: 'EXOTEL_CONNECTED_EVENT',
        });
        break;
      case 'start': {
        const start =
          payload.start && typeof payload.start === 'object'
            ? (payload.start as Record<string, unknown>)
            : {};
        this.logger.log({
          socketSessionId,
          streamSid:
            start.stream_sid ?? start.streamSid ?? payload.stream_sid ?? null,
          callSid: start.call_sid ?? start.callSid ?? null,
          accountSid: start.account_sid ?? start.accountSid ?? null,
          from: start.from ?? null,
          to: start.to ?? null,
          message: 'EXOTEL_START_RECEIVED',
        });
        break;
      }
      case 'media': {
        if (!this.loggedFirstMediaBySocket.has(socketSessionId)) {
          this.loggedFirstMediaBySocket.add(socketSessionId);
          const bytes = readExotelMediaPayloadBytes(payload);
          this.logger.log({
            socketSessionId,
            streamSid: payload.stream_sid ?? payload.streamSid ?? null,
            message: `EXOTEL_MEDIA_RECEIVED bytes=${bytes}`,
          });
        }
        break;
      }
      case 'stop':
        this.logger.log({
          socketSessionId,
          streamSid: payload.stream_sid ?? payload.streamSid ?? null,
          message: 'EXOTEL_STOP_RECEIVED',
        });
        break;
      default:
        break;
    }

    const normalized = normalizeExotelStreamPayload(payload);

    if (event === 'start') {
      const start = asRecord(normalized.start) ?? {};
      const streamSid =
        (typeof start.streamSid === 'string' ? start.streamSid : undefined) ??
        (typeof normalized.streamSid === 'string' ? normalized.streamSid : undefined);
      if (streamSid) {
        this.voiceSocketRegistry.markExotelStream(streamSid, socketSessionId);
      }
    }

    this.smartfloStreamAdapter.handleMessage(
      socketSessionId,
      JSON.stringify(normalized),
    );
  }

  finalizeRecordingForStreamAsync(
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    return this.smartfloStreamAdapter.finalizeRecordingForStreamAsync(
      streamSid,
      callSid,
    );
  }
}
