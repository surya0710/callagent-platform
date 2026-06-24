import { Injectable, Logger } from '@nestjs/common';
import { VoiceSessionService } from '../voice-session.service';
import {
  VoiceRuntimePrewarmContext,
  VoiceRuntimeProvider,
  VoiceRuntimeSessionContext,
} from './voice-runtime.provider';

@Injectable()
export class MockVoiceRuntimeProvider implements VoiceRuntimeProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockVoiceRuntimeProvider.name);

  constructor(private readonly voiceSessionService: VoiceSessionService) {}

  onSocketConnected(socketSessionId: string): void {
    this.logger.log({
      socketSessionId,
      event: 'connected',
      message: 'Smartflo handshake received',
    });
  }

  prewarmAuthorizedCall(input: VoiceRuntimePrewarmContext): void {
    this.logger.log({
      callSid: input.callSid,
      aiSpeakFirstEnabled: input.aiSpeakFirstEnabled,
      message: 'voice_openai_prewarm_skipped_mock_runtime',
    });
  }

  async createSession(context: VoiceRuntimeSessionContext): Promise<void> {
    this.logger.log({ streamSid: context.streamSid, event: 'start', context });
    this.voiceSessionService.updateRuntimeState(context.streamSid, {
      runtimeProvider: this.name,
      runtimeStatus: 'connected',
      runtimeConnectedAt: new Date(),
      runtimeLastEventAt: new Date(),
    });
  }

  handleAudio(streamSid: string, pcm16Audio: Buffer): void {
    this.logger.debug({
      streamSid,
      event: 'media',
      pcmBytes: pcm16Audio.length,
      sampleCount: Math.floor(pcm16Audio.length / 2),
    });
  }

  async endSession(streamSid: string): Promise<void> {
    this.logger.log({ streamSid, event: 'stop' });
    this.voiceSessionService.updateRuntimeState(streamSid, {
      runtimeStatus: 'closed',
      runtimeLastEventAt: new Date(),
    });
  }
}
