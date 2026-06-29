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
import { TelephonyMediaEncoding, TelephonyProvider } from './telephony/telephony-provider.types';
import { encodePcm16ToMulaw } from './audio/mulaw-codec';
import { parseVoiceStreamProviderFromRequest } from './voice-stream-provider.util';

interface VoiceWebSocket extends WebSocket {
  socketSessionId?: string;
}

const MULAW_FRAME_BYTES = 160;
const EXOTEL_PCM_FRAME_BYTES = 320;

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

  private resolveConnectionStreamProvider(
    request: IncomingMessage,
  ): TelephonyProvider {
    const fromQuery = parseVoiceStreamProviderFromRequest(request);
    if (fromQuery) {
      return fromQuery;
    }

    // Smartflo connects without a query param — never infer Exotel from dial env.
    return TelephonyProvider.SMARTFLO;
  }

  handleConnection(client: VoiceWebSocket, request: IncomingMessage): void {
    try {
      const remoteAddress =
        request.socket.remoteAddress ??
        (request.headers['x-forwarded-for'] as string | undefined);

      const streamProvider = this.resolveConnectionStreamProvider(request);
      const isExotel = streamProvider === TelephonyProvider.EXOTEL;

      const session = this.voiceSessionService.createSocketSession(remoteAddress);
      client.socketSessionId = session.socketSessionId;
      this.voiceSocketRegistry.registerSocket(session.socketSessionId, client);
      this.voiceSocketRegistry.setStreamProvider(
        session.socketSessionId,
        streamProvider,
      );

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
          streamProvider,
          message: 'EXOTEL_WS_CONNECTED',
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
      void this.finalizeAndDisconnect(
        socketSessionId,
        streamSid,
        session.callSid,
        this.voiceSocketRegistry.resolveStreamProvider(streamSid, socketSessionId),
      );
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
    callSid: string | undefined,
    streamProvider: TelephonyProvider,
  ): Promise<void> {
    if (streamProvider === TelephonyProvider.EXOTEL) {
      await this.exotelStreamAdapter.finalizeRecordingForStreamAsync(
        streamSid,
        callSid,
      );
    } else {
      await this.smartfloStreamAdapter.finalizeRecordingForStreamAsync(
        streamSid,
        callSid,
      );
    }

    this.voiceSessionService.endBySocketSessionId(socketSessionId);
    this.voiceSocketRegistry.removeBySocketSessionId(socketSessionId);

    this.logger.log({
      socketSessionId,
      streamProvider,
      message:
        streamProvider === TelephonyProvider.EXOTEL
          ? 'Exotel WebSocket disconnected'
          : 'Smartflo WebSocket disconnected',
    });
  }

  sendMedia(
    streamSid: string,
    base64Payload: string,
    chunk?: number,
    encoding?: TelephonyMediaEncoding,
  ): void {
    const streamProvider =
      this.voiceSocketRegistry.resolveStreamProvider(streamSid);
    const isExotel = streamProvider === TelephonyProvider.EXOTEL;
    const sessionEncoding =
      this.voiceSessionService.getByStreamSid(streamSid)?.telephonyMediaEncoding;
    const mediaEncoding =
      encoding ?? sessionEncoding ?? 'mulaw';
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    const wsReadyState = client?.readyState ?? WebSocket.CLOSED;
    const socketFound = Boolean(client && wsReadyState === WebSocket.OPEN);

    voiceDebugLog(this.logger, streamSid, 'outbound_ws_ready_state', {
      readyState: wsReadyState,
      encoding: mediaEncoding,
      streamProvider,
    });

    if (!socketFound) {
      this.voiceSessionService.recordSmartfloSendFailure(streamSid, wsReadyState);
      voiceDebugLog(this.logger, streamSid, 'smartflo_send_error', {
        reason: 'ws_not_open',
        readyState: wsReadyState,
      });
      this.logger.warn({
        streamSid,
        payloadBase64Length: base64Payload.length,
        socketFound: false,
        wsReadyState,
        encoding: mediaEncoding,
        streamProvider,
        message: 'Cannot send media: no active WebSocket for streamSid',
      });
      return;
    }

    const decodedLength = Buffer.from(base64Payload, 'base64').length;
    voiceDebugLog(this.logger, streamSid, 'outbound_payload_bytes', {
      bytes: decodedLength,
      encoding: mediaEncoding,
      streamProvider,
    });

    if (mediaEncoding === 'pcm16') {
      if (decodedLength % 2 !== 0) {
        this.logger.warn({
          streamSid,
          decodedByteLength: decodedLength,
          message: 'Outbound PCM media payload has odd byte length',
        });
      } else if (
        decodedLength < EXOTEL_PCM_FRAME_BYTES ||
        decodedLength % EXOTEL_PCM_FRAME_BYTES !== 0
      ) {
        this.logger.warn({
          streamSid,
          decodedByteLength: decodedLength,
          message: 'Outbound Exotel PCM payload is not a multiple of 320 bytes',
        });
      }
    } else if (
      decodedLength < MULAW_FRAME_BYTES ||
      decodedLength % MULAW_FRAME_BYTES !== 0
    ) {
      this.logger.warn({
        streamSid,
        decodedByteLength: decodedLength,
        message: 'Outbound media payload is not a multiple of 160 bytes',
      });
    }

    let outboundMessage: string;

    if (isExotel) {
      outboundMessage = JSON.stringify({
        event: 'media',
        stream_sid: streamSid,
        media: {
          payload: base64Payload,
        },
      });

      this.logger.log({
        streamSid,
        payloadBase64Length: base64Payload.length,
        mediaBytes: decodedLength,
        encoding: mediaEncoding,
        streamProvider,
        socketFound: true,
        wsReadyState,
        message: `EXOTEL_AUDIO_SENT bytes=${decodedLength}`,
      });
    } else {
      const chunkNumber =
        chunk ?? this.voiceSocketRegistry.nextOutboundChunk(streamSid);
      const chunkDurationMs = this.voiceAudioConfigService.getOutboundChunkMs('mulaw');
      const timestamp = this.voiceSocketRegistry.nextOutboundTimestamp(
        streamSid,
        chunkDurationMs,
      );
      const sequenceNumber =
        this.voiceSocketRegistry.nextOutboundSequenceNumber(streamSid);

      outboundMessage = JSON.stringify({
        event: 'media',
        streamSid,
        sequenceNumber,
        media: {
          payload: base64Payload,
          chunk: String(chunkNumber),
          timestamp: String(timestamp),
        },
      });

      this.logger.log({
        streamSid,
        sequenceNumber,
        chunk: chunkNumber,
        timestamp,
        payloadBase64Length: base64Payload.length,
        mediaBytes: decodedLength,
        encoding: mediaEncoding,
        socketFound: true,
        wsReadyState,
        message: 'Sending outbound media to telephony WebSocket',
      });
    }

    try {
      client!.send(outboundMessage);
      this.voiceSessionService.recordSmartfloOutboundSend(
        streamSid,
        decodedLength,
        wsReadyState,
      );
      voiceDebugLog(this.logger, streamSid, 'outbound_audio_chunk', {
        bytes: decodedLength,
        encoding: mediaEncoding,
        streamProvider,
      });
      this.logger.debug({
        streamSid,
        mediaBytes: decodedLength,
        encoding: mediaEncoding,
        streamProvider,
        message: 'Outbound media WebSocket send succeeded',
      });
    } catch (error) {
      this.voiceSessionService.recordSmartfloSendFailure(streamSid, wsReadyState);
      voiceDebugLog(this.logger, streamSid, 'smartflo_send_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.error({
        streamSid,
        err: error,
        streamProvider,
        message: 'Outbound media WebSocket send failed',
      });
      return;
    }

    setImmediate(() => {
      try {
        const recordingPayload =
          mediaEncoding === 'pcm16'
            ? encodePcm16ToMulaw(Buffer.from(base64Payload, 'base64')).toString(
                'base64',
              )
            : base64Payload;
        this.voiceRecordingService.appendOutboundMulawBase64(
          streamSid,
          recordingPayload,
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

    const isExotel =
      this.voiceSocketRegistry.resolveStreamProvider(streamSid) ===
      TelephonyProvider.EXOTEL;

    client.send(
      JSON.stringify(
        isExotel
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

    const isExotel =
      this.voiceSocketRegistry.resolveStreamProvider(streamSid) ===
      TelephonyProvider.EXOTEL;

    client.send(
      JSON.stringify(
        isExotel
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
