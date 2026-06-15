import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceAudioConfigService } from './audio/voice-audio-config.service';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';

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
    private readonly voiceRecordingService: VoiceRecordingService,
    private readonly voiceAudioConfigService: VoiceAudioConfigService,
  ) {}

  handleConnection(client: VoiceWebSocket, request: IncomingMessage): void {
    try {
      const remoteAddress =
        request.socket.remoteAddress ??
        (request.headers['x-forwarded-for'] as string | undefined);

      const session = this.voiceSessionService.createSocketSession(remoteAddress);
      client.socketSessionId = session.socketSessionId;
      this.voiceSocketRegistry.registerSocket(session.socketSessionId, client);

      client.on('message', (data) => {
        const raw =
          typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data);

        this.smartfloStreamAdapter.handleMessage(session.socketSessionId, raw);
      });

      client.on('error', (error) => {
        this.logger.error(
          { socketSessionId: session.socketSessionId, err: error },
          'WebSocket client error',
        );
      });

      this.logger.log({
        socketSessionId: session.socketSessionId,
        remoteAddress,
        connectedAt: session.connectedAt,
        message: 'Smartflo WebSocket connected',
      });
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
    await this.smartfloStreamAdapter.finalizeRecordingForStreamAsync(
      streamSid,
      callSid,
    );

    this.voiceSessionService.endBySocketSessionId(socketSessionId);
    this.voiceSocketRegistry.removeBySocketSessionId(socketSessionId);

    this.logger.log({
      socketSessionId,
      message: 'Smartflo WebSocket disconnected',
    });
  }

  sendMedia(streamSid: string, base64MulawPayload: string, chunk?: number): void {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    const socketFound = Boolean(client && client.readyState === WebSocket.OPEN);

    if (!socketFound) {
      this.logger.warn({
        streamSid,
        payloadBase64Length: base64MulawPayload.length,
        socketFound: false,
        message: 'Cannot send media: no active WebSocket for streamSid',
      });
      return;
    }

    const decodedLength = Buffer.from(base64MulawPayload, 'base64').length;
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

    this.logger.log({
      streamSid,
      sequenceNumber,
      chunk: chunkNumber,
      timestamp,
      payloadBase64Length: base64MulawPayload.length,
      mulawBytes: decodedLength,
      socketFound: true,
      message: 'Sending outbound media to Smartflo WebSocket',
    });

    // Recording uses wall-clock offsets; Smartflo media timestamps are sequential from 0.
    this.voiceRecordingService.appendOutboundMulawBase64(
      streamSid,
      base64MulawPayload,
    );

    const outboundMessage = JSON.stringify({
      event: 'media',
      streamSid,
      sequenceNumber,
      media: {
        payload: base64MulawPayload,
        chunk: chunkNumber,
        timestamp: String(timestamp),
      },
    });

    try {
      client!.send(outboundMessage);
      this.logger.debug({
        streamSid,
        chunk: chunkNumber,
        message: 'Outbound media WebSocket send succeeded',
      });
    } catch (error) {
      this.logger.error({
        streamSid,
        chunk: chunkNumber,
        err: error,
        message: 'Outbound media WebSocket send failed',
      });
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
      JSON.stringify({
        event: 'mark',
        streamSid,
        mark: { name },
      }),
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
      JSON.stringify({
        event: 'clear',
        streamSid,
      }),
    );
  }
}
