import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { ExotelStreamAdapter } from './exotel-stream.adapter';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { voiceDebugLog } from './audio/voice-debug.util';
import { VoiceAudioConfigService } from './audio/voice-audio-config.service';
import {
  generateMulawToneBuffer,
  isSyntheticToneDebugEnabled,
  splitMulawIntoFixedChunks,
} from './audio/smartflo-synthetic-tone.util';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';
import {
  CallTimingDiagnosticsService,
  CallTimingEvent,
} from './call-timing-diagnostics.service';
import { parseVoiceStreamProviderFromRequest } from './voice-stream-provider.util';
import { TelephonyProvider } from './telephony/telephony-provider.types';
import { smartfloMulawBase64ToExotelPcm16Base64 } from './telephony/exotel-media.util';

interface VoiceWebSocket extends WebSocket {
  socketSessionId?: string;
}

const MULAW_FRAME_BYTES = 160;

@WebSocketGateway({ path: '/api/voice/stream' })
export class AudioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AudioGateway.name);

  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
    private readonly smartfloStreamAdapter: SmartfloStreamAdapter,
    private readonly exotelStreamAdapter: ExotelStreamAdapter,
    private readonly voiceRecordingService: VoiceRecordingService,
    private readonly voiceAudioConfigService: VoiceAudioConfigService,
    private readonly callTiming: CallTimingDiagnosticsService,
  ) {}

  handleConnection(client: VoiceWebSocket, request: IncomingMessage): void {
    try {
      const remoteAddress =
        request.socket.remoteAddress ??
        (request.headers['x-forwarded-for'] as string | undefined);

      const session = this.voiceSessionService.createSocketSession(remoteAddress);
      client.socketSessionId = session.socketSessionId;
      this.voiceSocketRegistry.registerSocket(session.socketSessionId, client);

      const isExotel =
        parseVoiceStreamProviderFromRequest(request) === TelephonyProvider.EXOTEL;
      if (isExotel) {
        this.voiceSocketRegistry.registerExotelSocket(session.socketSessionId);
      }

      client.on('message', (data) => {
        const raw =
          typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data);

        if (isExotel) {
          this.exotelStreamAdapter.handleMessage(session.socketSessionId, raw);
          return;
        }

        this.smartfloStreamAdapter.handleMessage(session.socketSessionId, raw);
      });

      client.on('error', (error) => {
        this.logger.error(
          { socketSessionId: session.socketSessionId, err: error },
          'WebSocket client error',
        );
      });

      if (isExotel) {
        this.logger.log({
          socketSessionId: session.socketSessionId,
          remoteAddress,
          connectedAt: session.connectedAt,
          message: 'Exotel WebSocket connected',
        });
        return;
      }

      this.logger.log({
        socketSessionId: session.socketSessionId,
        remoteAddress,
        connectedAt: session.connectedAt,
        message: 'Smartflo WebSocket connected',
      });
      this.callTiming.mark(
        `socket:${session.socketSessionId}`,
        CallTimingEvent.SMARTFLO_MEDIA_WS_CONNECTED,
        { socketSessionId: session.socketSessionId },
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to handle WebSocket connection');
      client.close();
    }
  }

  handleDisconnect(client: VoiceWebSocket): void {
    const socketSessionId = client.socketSessionId;
    if (!socketSessionId) {
      return;
    }

    const session = this.voiceSessionService.getBySocketSessionId(socketSessionId);
    const streamSid = session?.streamSid;

    if (
      streamSid &&
      session &&
      (session.status === 'ACTIVE' || session.status === 'PENDING')
    ) {
      void this.finalizeAndDisconnect(socketSessionId, streamSid, session.callSid);
      return;
    }

    this.voiceSessionService.endBySocketSessionId(socketSessionId);
    this.voiceSocketRegistry.removeBySocketSessionId(socketSessionId);

    this.logger.log({
      socketSessionId,
      message: 'Smartflo WebSocket disconnected',
    });
  }

  private async finalizeAndDisconnect(
    socketSessionId: string,
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    const adapter = this.voiceSocketRegistry.isExotelStream(streamSid)
      ? this.exotelStreamAdapter
      : this.smartfloStreamAdapter;

    await adapter.finalizeRecordingForStreamAsync(streamSid, callSid);

    this.voiceSessionService.endBySocketSessionId(socketSessionId);
    this.voiceSocketRegistry.removeBySocketSessionId(socketSessionId);

    this.logger.log({
      socketSessionId,
      message: 'Smartflo WebSocket disconnected',
    });
  }

  sendMedia(streamSid: string, base64MulawPayload: string, chunk?: number): void {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    const wsReadyState = client?.readyState ?? WebSocket.CLOSED;
    const socketFound = Boolean(client && wsReadyState === WebSocket.OPEN);

    voiceDebugLog(this.logger, streamSid, 'outbound_ws_ready_state', {
      readyState: wsReadyState,
    });

    if (!socketFound) {
      this.voiceSessionService.recordSmartfloSendFailure(streamSid, wsReadyState);
      voiceDebugLog(this.logger, streamSid, 'smartflo_send_error', {
        reason: 'ws_not_open',
        readyState: wsReadyState,
      });
      this.logger.warn({
        streamSid,
        payloadBase64Length: base64MulawPayload.length,
        socketFound: false,
        wsReadyState,
        message: 'Cannot send media: no active WebSocket for streamSid',
      });
      return;
    }

    const decodedLength = Buffer.from(base64MulawPayload, 'base64').length;
    voiceDebugLog(this.logger, streamSid, 'outbound_payload_bytes', {
      bytes: decodedLength,
    });

    if (decodedLength < MULAW_FRAME_BYTES || decodedLength % MULAW_FRAME_BYTES !== 0) {
      this.logger.warn({
        streamSid,
        decodedByteLength: decodedLength,
        message: 'Outbound media payload is not a multiple of 160 bytes',
      });
    }

    const chunkNumber =
      chunk ?? this.voiceSocketRegistry.nextOutboundChunk(streamSid);
    const chunkDurationMs = this.voiceAudioConfigService.getOutboundChunkMs();
    const timestamp = this.voiceSocketRegistry.nextOutboundTimestamp(
      streamSid,
      chunkDurationMs,
    );
    const sequenceNumber =
      this.voiceSocketRegistry.nextOutboundSequenceNumber(streamSid);

    const isExotel = this.voiceSocketRegistry.isExotelStream(streamSid);
    const exotelPayload = isExotel
      ? smartfloMulawBase64ToExotelPcm16Base64(base64MulawPayload)
      : base64MulawPayload;
    const outboundMessage = isExotel
      ? JSON.stringify({
          event: 'media',
          stream_sid: streamSid,
          media: {
            payload: exotelPayload,
          },
        })
      : JSON.stringify({
          event: 'media',
          streamSid,
          sequenceNumber,
          media: {
            payload: base64MulawPayload,
            chunk: String(chunkNumber),
            timestamp: String(timestamp),
          },
        });

    this.logger.log({
      streamSid,
      sequenceNumber,
      chunk: chunkNumber,
      timestamp,
      payloadBase64Length: base64MulawPayload.length,
      mulawBytes: decodedLength,
      socketFound: true,
      wsReadyState,
      message: 'Sending outbound media to Smartflo WebSocket',
    });

    try {
      client!.send(outboundMessage);
      this.voiceSessionService.recordSmartfloOutboundSend(
        streamSid,
        decodedLength,
        wsReadyState,
      );
      voiceDebugLog(this.logger, streamSid, 'outbound_audio_chunk', {
        bytes: decodedLength,
        chunk: chunkNumber,
      });
      this.logger.debug({
        streamSid,
        chunk: chunkNumber,
        mulawBytes: decodedLength,
        message: 'Outbound media WebSocket send succeeded',
      });
    } catch (error) {
      this.voiceSessionService.recordSmartfloSendFailure(streamSid, wsReadyState);
      voiceDebugLog(this.logger, streamSid, 'smartflo_send_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.error({
        streamSid,
        chunk: chunkNumber,
        err: error,
        message: 'Outbound media WebSocket send failed',
      });
      return;
    }

    // Recording is off the live path — never block or prevent Smartflo playback.
    setImmediate(() => {
      try {
        this.voiceRecordingService.appendOutboundMulawBase64(
          streamSid,
          base64MulawPayload,
        );
      } catch (error) {
        voiceDebugLog(this.logger, streamSid, 'recording_error', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.warn({
          streamSid,
          err: error,
          message: 'Outbound recording append failed; live media send continues',
        });
      }
    });
  }

  sendSyntheticTone(streamSid: string, durationMs = 1500): void {
    if (!isSyntheticToneDebugEnabled()) {
      return;
    }

    const chunkBytes = this.voiceAudioConfigService.getOutboundChunkBytes();
    const tone = generateMulawToneBuffer({
      frequencyHz: 440,
      durationMs,
      sampleRate: 8000,
      amplitude: 8000,
    });
    const chunks = splitMulawIntoFixedChunks(tone, chunkBytes);

    this.logger.warn({
      streamSid,
      durationMs,
      chunkBytes,
      chunkCount: chunks.length,
      message: 'VOICE_DEBUG_SYNTHETIC_TONE enabled — sending diagnostic tone',
    });

    for (const chunk of chunks) {
      this.sendMedia(streamSid, chunk.toString('base64'));
    }
  }

  sendMark(streamSid: string, name: string): void {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    if (!client || client.readyState !== WebSocket.OPEN) {
      this.logger.warn({
        streamSid,
        message: 'Cannot send mark: no active WebSocket for streamSid',
      });
      return;
    }

    client.send(
      JSON.stringify(
        this.voiceSocketRegistry.isExotelStream(streamSid)
          ? {
              event: 'mark',
              stream_sid: streamSid,
              mark: { name },
            }
          : {
              event: 'mark',
              streamSid,
              mark: { name },
            },
      ),
    );
  }

  sendClear(streamSid: string): void {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    if (!client || client.readyState !== WebSocket.OPEN) {
      this.logger.warn({
        streamSid,
        message: 'Cannot send clear: no active WebSocket for streamSid',
      });
      return;
    }

    client.send(
      JSON.stringify(
        this.voiceSocketRegistry.isExotelStream(streamSid)
          ? {
              event: 'clear',
              stream_sid: streamSid,
            }
          : {
              event: 'clear',
              streamSid,
            },
      ),
    );
  }

  closeStream(streamSid: string, reason = 'ai_conversation_complete'): void {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    if (!client || client.readyState !== WebSocket.OPEN) {
      this.logger.warn({
        streamSid,
        reason,
        message: 'Cannot close stream: no active WebSocket for streamSid',
      });
      return;
    }

    this.logger.log({
      streamSid,
      reason,
      message: 'Closing Smartflo stream from AI runtime',
    });
    client.close(1000, reason);
  }
}
