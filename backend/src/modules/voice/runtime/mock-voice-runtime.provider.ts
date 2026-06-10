import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MockVoiceRuntimeProvider {
  private readonly logger = new Logger(MockVoiceRuntimeProvider.name);

  onConnected(socketSessionId: string): void {
    this.logger.log({
      socketSessionId,
      event: 'connected',
      message: 'Smartflo handshake received',
    });
  }

  onStart(streamSid: string, payload: unknown): void {
    this.logger.log({ streamSid, event: 'start', payload });
  }

  onMedia(
    streamSid: string,
    details: {
      sequenceNumber?: unknown;
      chunk?: unknown;
      timestamp?: unknown;
      payloadLength?: number;
    },
  ): void {
    this.logger.log({ streamSid, event: 'media', ...details });
  }

  onDtmf(streamSid: string, digit: unknown): void {
    this.logger.log({ streamSid, event: 'dtmf', digit });
  }

  onMark(streamSid: string, name: unknown): void {
    this.logger.log({ streamSid, event: 'mark', name });
  }

  onClear(streamSid: string): void {
    this.logger.log({ streamSid, event: 'clear' });
  }

  onStop(streamSid: string, reason: unknown): void {
    this.logger.log({ streamSid, event: 'stop', reason });
  }
}
