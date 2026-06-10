import { Module } from '@nestjs/common';
import { AudioGateway } from './audio.gateway';
import { MockVoiceRuntimeProvider } from './runtime/mock-voice-runtime.provider';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { VoiceController } from './voice.controller';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';

@Module({
  controllers: [VoiceController],
  providers: [
    VoiceSessionService,
    VoiceSocketRegistry,
    SmartfloStreamAdapter,
    MockVoiceRuntimeProvider,
    AudioGateway,
  ],
  exports: [AudioGateway],
})
export class VoiceModule {}
