import { Injectable, Logger } from '@nestjs/common';
import { CallTimingDiagnosticsService, CallTimingEvent } from './call-timing-diagnostics.service';
import { normalizeVoicePhoneNumber } from './voice-phone.util';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceStreamRuntimeBridge } from './stream/voice-stream-runtime.bridge';
import { TelephonyProvider } from './telephony/telephony-provider.types';
import {
  normalizeExotelStreamEvent,
  readExotelMediaPayloadBytes,
} from './telephony/stream/exotel-stream.normalizer';

const PROVIDER = TelephonyProvider.EXOTEL;

@Injectable()
export class ExotelStreamAdapter {
  private readonly logger = new Logger(ExotelStreamAdapter.name);
  private readonly loggedFirstMediaBySocket = new Set<string>();
  private readonly loggedMediaShapeByStreamSid = new Set<string>();

  constructor(
    private readonly voiceStreamRuntimeBridge: VoiceStreamRuntimeBridge,
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
    private readonly voiceRecordingService: VoiceRecordingService,
    private readonly callTiming: CallTimingDiagnosticsService,
  ) {}

  handleMessage(socketSessionId: string, raw: string): void {
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.logger.warn({
        telephonyProvider: PROVIDER,
        socketSessionId,
        message: 'Invalid JSON in Exotel WebSocket message',
      });
      return;
    }

    const event = payload.event;
    if (typeof event !== 'string') {
      this.logger.warn({
        telephonyProvider: PROVIDER,
        socketSessionId,
        message: 'Missing or invalid event field in Exotel WebSocket message',
      });
      return;
    }

    this.logger.debug({
      telephonyProvider: PROVIDER,
      socketSessionId,
      event,
      message: 'exotel stream event received',
    });

    const normalized = normalizeExotelStreamEvent(payload);

    switch (normalized.event) {
      case 'connected':
        this.voiceStreamRuntimeBridge.handleConnected(PROVIDER, socketSessionId);
        break;
      case 'start':
        void this.handleStart(socketSessionId, normalized);
        break;
      case 'media':
        this.handleMedia(socketSessionId, normalized, payload);
        break;
      case 'dtmf':
        this.handlePassthrough(socketSessionId, normalized.raw, 'dtmf');
        break;
      case 'mark':
        this.handlePassthrough(socketSessionId, normalized.raw, 'mark');
        break;
      case 'clear':
        this.handlePassthrough(socketSessionId, normalized.raw, 'clear');
        break;
      case 'stop':
        void this.handleStop(socketSessionId, normalized);
        break;
      default:
        this.logger.warn({
          telephonyProvider: PROVIDER,
          socketSessionId,
          event,
          message: 'Unknown Exotel stream event',
        });
    }
  }

  private async handleStart(
    socketSessionId: string,
    normalized: Extract<
      ReturnType<typeof normalizeExotelStreamEvent>,
      { event: 'start' }
    >,
  ): Promise<void> {
    const { streamSid, start: startData } = normalized;

    this.logger.log({
      telephonyProvider: PROVIDER,
      socketSessionId,
      streamSid,
      callSid: startData.callSid,
      from: startData.from,
      to: startData.to,
      message: 'exotel start event received',
    });

    this.voiceSessionService.bindStreamSid(socketSessionId, startData);
    this.voiceSocketRegistry.bindStreamSid(socketSessionId, streamSid);
    this.voiceSocketRegistry.markExotelStream(streamSid, socketSessionId);
    this.voiceSessionService.markAuthorizationPending(streamSid);
    this.voiceRecordingService.start(streamSid, startData.callSid);

    const linkedPhone = [startData.to, startData.from]
      .map((value) =>
        value ? normalizeVoicePhoneNumber(value) : undefined,
      )
      .find((value): value is string => Boolean(value));
    if (linkedPhone) {
      this.callTiming.linkStreamSid(streamSid, `phone:${linkedPhone}`);
    }
    if (startData.callSid) {
      this.callTiming.linkStreamSid(streamSid, `callSid:${startData.callSid}`);
    }
    this.callTiming.linkAlias(
      `socket:${socketSessionId}`,
      linkedPhone ? `phone:${linkedPhone}` : `streamSid:${streamSid}`,
    );
    this.callTiming.markByStreamSid(
      streamSid,
      CallTimingEvent.SMARTFLO_START_RECEIVED,
      {
        telephonyProvider: PROVIDER,
        callSid: startData.callSid,
        from: startData.from,
        to: startData.to,
      },
    );

    await this.voiceStreamRuntimeBridge.authorizeAndStartRuntime(
      PROVIDER,
      socketSessionId,
      streamSid,
      startData,
      this.voiceSessionService.getSocketQueryAuthorizationId(socketSessionId),
    );
  }

  private handleMedia(
    socketSessionId: string,
    normalized: Extract<
      ReturnType<typeof normalizeExotelStreamEvent>,
      { event: 'media' }
    >,
    rawPayload: Record<string, unknown>,
  ): void {
    const streamSid =
      normalized.streamSid ||
      this.voiceSessionService.resolveStreamSid(undefined, socketSessionId);

    if (!streamSid) {
      this.logger.warn({
        telephonyProvider: PROVIDER,
        socketSessionId,
        message: 'Exotel media event received before streamSid binding',
      });
      return;
    }

    if (!this.loggedFirstMediaBySocket.has(socketSessionId)) {
      this.loggedFirstMediaBySocket.add(socketSessionId);
      this.logger.log({
        telephonyProvider: PROVIDER,
        socketSessionId,
        streamSid,
        payloadBytes: readExotelMediaPayloadBytes(rawPayload),
        message: 'exotel first media event received',
      });
    }

    if (!this.loggedMediaShapeByStreamSid.has(streamSid)) {
      this.loggedMediaShapeByStreamSid.add(streamSid);
      this.logger.log({
        telephonyProvider: PROVIDER,
        streamSid,
        pcm16Bytes: normalized.pcm16Audio.length,
        message: 'First inbound Exotel media decode stats',
      });
    }

    this.voiceSessionService.recordMedia(socketSessionId, rawPayload);

    if (normalized.pcm16Audio.length === 0) {
      this.logger.warn({
        telephonyProvider: PROVIDER,
        streamSid,
        message: 'Exotel media event missing PCM16 payload',
      });
      return;
    }

    this.voiceStreamRuntimeBridge.handleInboundPcm16(
      PROVIDER,
      socketSessionId,
      streamSid,
      normalized.pcm16Audio,
      {
        recordingInboundMulawBase64: normalized.recordingInboundMulawBase64,
        logLabel: 'Inbound Exotel PCM16 decode stats (first chunk)',
      },
    );
  }

  private handlePassthrough(
    socketSessionId: string,
    payload: Record<string, unknown>,
    kind: 'dtmf' | 'mark' | 'clear',
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.stream_sid ?? payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        telephonyProvider: PROVIDER,
        socketSessionId,
        message: `Exotel ${kind} event received before streamSid binding`,
      });
      return;
    }

    if (kind === 'dtmf') {
      this.voiceSessionService.recordDtmf(socketSessionId, payload);
    } else if (kind === 'mark') {
      this.voiceSessionService.recordMark(socketSessionId, payload);
    } else {
      this.voiceSessionService.recordClear(socketSessionId, payload);
    }
  }

  private async handleStop(
    socketSessionId: string,
    normalized: Extract<
      ReturnType<typeof normalizeExotelStreamEvent>,
      { event: 'stop' }
    >,
  ): Promise<void> {
    const streamSid =
      normalized.streamSid ||
      this.voiceSessionService.resolveStreamSid(undefined, socketSessionId);

    if (!streamSid) {
      this.logger.warn({
        telephonyProvider: PROVIDER,
        socketSessionId,
        message: 'Exotel stop event received before streamSid binding',
      });
      return;
    }

    this.logger.log({
      telephonyProvider: PROVIDER,
      socketSessionId,
      streamSid,
      stopReason: normalized.reason ?? null,
      message: 'exotel stop event received',
    });

    await this.voiceStreamRuntimeBridge.finalizeOnStop(
      PROVIDER,
      socketSessionId,
      streamSid,
      normalized.callSid ??
        this.voiceSessionService.getByStreamSid(streamSid)?.callSid,
      normalized.reason ?? null,
    );
  }

  finalizeRecordingForStreamAsync(
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    return this.voiceStreamRuntimeBridge.finalizeRecordingForStreamAsync(
      PROVIDER,
      streamSid,
      callSid,
    );
  }
}
