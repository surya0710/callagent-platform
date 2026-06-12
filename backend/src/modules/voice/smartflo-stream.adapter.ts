import { Injectable, Logger } from '@nestjs/common';
import { decodeMulawBuffer } from './audio/mulaw-codec';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
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
    private readonly voiceRuntimeFactory: VoiceRuntimeFactory,
    private readonly voiceRecordingService: VoiceRecordingService,
  ) {}

  private get voiceRuntime() {
    return this.voiceRuntimeFactory.getProvider();
  }

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
    this.voiceRuntime.onSocketConnected?.(socketSessionId);
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
    this.voiceRecordingService.start(streamSid, startData.callSid);

    this.logger.log({
      socketSessionId,
      streamSid,
      smartfloEvent: payload,
      message: 'Voice session bound to streamSid',
    });

    void this.voiceRuntime.createSession({
      streamSid,
      socketSessionId,
      callSid: startData.callSid,
      from: startData.from,
      to: startData.to,
      direction: startData.direction,
    });
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

    if (payloadStr) {
      this.voiceRecordingService.appendMulawBase64(streamSid, payloadStr);

      try {
        const mulawBuffer = Buffer.from(payloadStr, 'base64');
        if (mulawBuffer.length > 0) {
          const pcm16Audio = decodeMulawBuffer(mulawBuffer);
          this.voiceRuntime.handleAudio(streamSid, pcm16Audio);
        }
      } catch (error) {
        this.logger.warn({
          streamSid,
          err: error,
          message: 'Failed to decode inbound media for runtime provider',
        });
      }
    }
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

    this.voiceSessionService.recordDtmf(socketSessionId, payload);
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

    this.voiceSessionService.recordMark(socketSessionId, payload);
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

    void this.finalizeAndEndOnStop(
      socketSessionId,
      streamSid,
      (typeof stop?.callSid === 'string' ? stop.callSid : undefined) ??
        this.voiceSessionService.getByStreamSid(streamSid)?.callSid,
      stopReason,
    );
  }

  async endRuntimeForStream(streamSid: string): Promise<void> {
    try {
      await this.voiceRuntime.endSession(streamSid);
    } catch (error) {
      this.logger.error(
        { streamSid, err: error },
        'Failed to end voice runtime session',
      );
    }
  }

  finalizeRecordingForStream(
    streamSid: string,
    callSid?: string,
  ): void {
    void this.finalizeRecording(streamSid, callSid);
  }

  async finalizeRecordingForStreamAsync(
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    await this.endRuntimeForStream(streamSid);
    await this.finalizeRecording(streamSid, callSid);
  }

  private async finalizeAndEndOnStop(
    socketSessionId: string,
    streamSid: string,
    callSid: string | undefined,
    stopReason: string | null,
  ): Promise<void> {
    // Keep Smartflo socket open while OpenAI finishes its response.
    await this.endRuntimeForStream(streamSid);
    await this.finalizeRecording(streamSid, callSid);

    this.voiceSessionService.endByStreamSid(streamSid, stopReason);
    this.voiceSocketRegistry.removeByStreamSid(streamSid);

    this.logger.log({
      socketSessionId,
      streamSid,
      message: 'Voice session ended on stop event',
    });
  }

  private async finalizeRecording(
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    try {
      const metadata = await this.voiceRecordingService.finalize(
        streamSid,
        callSid,
      );
      if (!metadata) {
        return;
      }

      this.voiceSessionService.attachRecordingMetadata(streamSid, {
        fileName: metadata.fileName,
        durationMsEstimate: metadata.durationMsEstimate,
        mulawBytes: metadata.mulawBytes,
        wavBytes: metadata.wavBytes,
      });
    } catch (error) {
      this.logger.error(
        { streamSid, err: error },
        'Failed to finalize voice recording',
      );
    }
  }
}
