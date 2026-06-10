import { Injectable, Logger } from '@nestjs/common';
import { MockVoiceRuntimeProvider } from './runtime/mock-voice-runtime.provider';
import { VoiceSessionService } from './voice-session.service';

@Injectable()
export class SmartfloStreamAdapter {
  private readonly logger = new Logger(SmartfloStreamAdapter.name);

  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly mockVoiceRuntime: MockVoiceRuntimeProvider,
  ) {}

  handleMessage(sessionId: string, raw: string): void {
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.logger.warn({ sessionId, message: 'Invalid JSON in WebSocket message' });
      return;
    }

    this.logger.log({ sessionId, smartfloEvent: payload });

    const event = payload.event;
    if (typeof event !== 'string') {
      this.logger.warn({ sessionId, message: 'Missing or invalid event field' });
      return;
    }

    switch (event) {
      case 'connected':
        this.mockVoiceRuntime.onConnected(sessionId, payload);
        break;

      case 'start': {
        const start = payload.start;
        if (start && typeof start === 'object') {
          const startObj = start as Record<string, unknown>;
          this.voiceSessionService.update(sessionId, {
            callSid:
              typeof startObj.callSid === 'string' ? startObj.callSid : undefined,
            streamSid:
              typeof startObj.streamSid === 'string'
                ? startObj.streamSid
                : undefined,
          });
        }
        this.mockVoiceRuntime.onStart(sessionId, payload);
        break;
      }

      case 'media':
        this.mockVoiceRuntime.onMedia(sessionId, payload.media);
        break;

      case 'dtmf':
        this.mockVoiceRuntime.onDtmf(sessionId, payload.dtmf);
        break;

      case 'mark':
        this.mockVoiceRuntime.onMark(sessionId, payload.mark);
        break;

      case 'clear':
        this.mockVoiceRuntime.onClear(sessionId, payload.clear);
        break;

      case 'stop':
        this.mockVoiceRuntime.onStop(sessionId, payload);
        break;

      default:
        this.logger.warn({ sessionId, message: `Unknown Smartflo event: ${event}` });
    }
  }
}
