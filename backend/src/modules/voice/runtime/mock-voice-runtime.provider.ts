import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MockVoiceRuntimeProvider {
  private readonly logger = new Logger(MockVoiceRuntimeProvider.name);

  onConnected(sessionId: string, payload: unknown): void {
    this.logger.log({ sessionId, event: 'connected', payload });
  }

  onStart(sessionId: string, payload: unknown): void {
    this.logger.log({ sessionId, event: 'start', payload });
  }

  onMedia(sessionId: string, media: unknown): void {
    const payloadLength =
      media &&
      typeof media === 'object' &&
      'payload' in media &&
      typeof (media as { payload: unknown }).payload === 'string'
        ? (media as { payload: string }).payload.length
        : undefined;

    this.logger.log({ sessionId, event: 'media', payloadLength });
  }

  onDtmf(sessionId: string, dtmf: unknown): void {
    this.logger.log({ sessionId, event: 'dtmf', dtmf });
  }

  onMark(sessionId: string, mark: unknown): void {
    this.logger.log({ sessionId, event: 'mark', mark });
  }

  onClear(sessionId: string, clear: unknown): void {
    this.logger.log({ sessionId, event: 'clear', clear });
  }

  onStop(sessionId: string, payload: unknown): void {
    this.logger.log({ sessionId, event: 'stop', payload });
  }
}
