import { Injectable, Logger } from '@nestjs/common';
import { MockVoiceRuntimeProvider } from './runtime/mock-voice-runtime.provider';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

@Injectable()
export class SmartfloStreamAdapter {
  private readonly logger = new Logger(SmartfloStreamAdapter.name);

  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
    private readonly mockVoiceRuntime: MockVoiceRuntimeProvider,
  ) {}

  handleMessage(socketSessionId: string, raw: string): void {
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.logger.warn({
        socketSessionId,
        message: 'Invalid JSON in WebSocket message',
      });
      return;
    }

    const event = payload.event;
    if (typeof event !== 'string') {
      this.logger.warn({
        socketSessionId,
        message: 'Missing or invalid event field',
      });
      return;
    }

    switch (event) {
      case 'connected':
        this.handleConnected(socketSessionId, payload);
        break;
      case 'start':
        this.handleStart(socketSessionId, payload);
        break;
      case 'media':
        this.handleMedia(socketSessionId, payload);
        break;
      case 'dtmf':
        this.handleDtmf(socketSessionId, payload);
        break;
      case 'mark':
        this.handleMark(socketSessionId, payload);
        break;
      case 'clear':
        this.handleClear(socketSessionId, payload);
        break;
      case 'stop':
        this.handleStop(socketSessionId, payload);
        break;
      default:
        this.logger.warn({
          socketSessionId,
          message: `Unknown Smartflo event: ${event}`,
        });
    }
  }

  private handleConnected(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    this.voiceSessionService.recordConnected(socketSessionId);
    this.logger.log({ socketSessionId, smartfloEvent: payload });
    this.mockVoiceRuntime.onConnected(socketSessionId);
  }

  private handleStart(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const start = asRecord(payload.start) ?? {};
    const streamSid =
      (typeof start.streamSid === 'string' ? start.streamSid : undefined) ??
      (typeof payload.streamSid === 'string' ? payload.streamSid : undefined);

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Start event missing streamSid',
      });
      return;
    }

    const startData = {
      streamSid,
      callSid: typeof start.callSid === 'string' ? start.callSid : undefined,
      accountSid:
        typeof start.accountSid === 'string' ? start.accountSid : undefined,
      from: typeof start.from === 'string' ? start.from : undefined,
      to: typeof start.to === 'string' ? start.to : undefined,
      direction:
        typeof start.direction === 'string' ? start.direction : undefined,
      mediaFormat: start.mediaFormat,
      customParameters: start.customParameters,
    };

    this.voiceSessionService.bindStreamSid(socketSessionId, startData);
    this.voiceSocketRegistry.bindStreamSid(socketSessionId, streamSid);

    this.logger.log({
      socketSessionId,
      streamSid,
      smartfloEvent: payload,
      message: 'Voice session bound to streamSid',
    });

    this.mockVoiceRuntime.onStart(streamSid, payload);
  }

  private handleMedia(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Media event received before streamSid binding',
      });
      return;
    }

    const media = asRecord(payload.media);
    const payloadStr =
      media && typeof media.payload === 'string' ? media.payload : undefined;

    this.voiceSessionService.recordMedia(socketSessionId, payload);

    this.mockVoiceRuntime.onMedia(streamSid, {
      sequenceNumber: payload.sequenceNumber,
      chunk: media?.chunk,
      timestamp: media?.timestamp,
      payloadLength: payloadStr?.length,
    });
  }

  private handleDtmf(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'DTMF event received before streamSid binding',
      });
      return;
    }

    const dtmf = asRecord(payload.dtmf);
    const digit = dtmf?.digit;

    this.voiceSessionService.recordDtmf(socketSessionId, payload);
    this.mockVoiceRuntime.onDtmf(streamSid, digit);
  }

  private handleMark(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Mark event received before streamSid binding',
      });
      return;
    }

    const mark = asRecord(payload.mark);

    this.voiceSessionService.recordMark(socketSessionId, payload);
    this.mockVoiceRuntime.onMark(streamSid, mark?.name);
  }

  private handleClear(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Clear event received before streamSid binding',
      });
      return;
    }

    this.voiceSessionService.recordClear(socketSessionId, payload);
    this.mockVoiceRuntime.onClear(streamSid);
  }

  private handleStop(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Stop event received before streamSid binding',
      });
      return;
    }

    const stop = asRecord(payload.stop);
    const stopReason =
      typeof stop?.reason === 'string' ? stop.reason : null;

    this.mockVoiceRuntime.onStop(streamSid, stop?.reason);

    this.voiceSessionService.endByStreamSid(streamSid, stopReason);
    this.voiceSocketRegistry.removeByStreamSid(streamSid);

    this.logger.log({
      socketSessionId,
      streamSid,
      message: 'Voice session ended on stop event',
    });
  }
}
