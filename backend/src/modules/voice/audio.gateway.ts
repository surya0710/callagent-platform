import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { VoiceSessionService } from './voice-session.service';

interface VoiceWebSocket extends WebSocket {
  sessionId?: string;
}

@WebSocketGateway({ path: '/api/voice/stream' })
export class AudioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AudioGateway.name);

  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly smartfloStreamAdapter: SmartfloStreamAdapter,
  ) {}

  handleConnection(client: VoiceWebSocket, request: IncomingMessage): void {
    try {
      const url = new URL(request.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token') ?? '';

      const remoteAddress =
        request.socket.remoteAddress ??
        (request.headers['x-forwarded-for'] as string | undefined);

      const session = this.voiceSessionService.create(token, remoteAddress);
      client.sessionId = session.id;

      client.on('message', (data) => {
        const raw =
          typeof data === 'string'
            ? data
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : String(data);

        this.smartfloStreamAdapter.handleMessage(session.id, raw);
      });

      client.on('error', (error) => {
        this.logger.error(
          { sessionId: session.id, err: error },
          'WebSocket client error',
        );
      });

      this.logger.log({
        sessionId: session.id,
        remoteAddress,
        message: 'Smartflo WebSocket connected',
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to handle WebSocket connection');
      client.close();
    }
  }

  handleDisconnect(client: VoiceWebSocket): void {
    const sessionId = client.sessionId;
    if (sessionId) {
      this.voiceSessionService.end(sessionId);
      this.logger.log({ sessionId, message: 'Smartflo WebSocket disconnected' });
    }
  }
}
