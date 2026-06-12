import { Module } from '@nestjs/common';
import { AudioGateway } from './audio.gateway';
import { LocalVoiceRecordingStorage } from './audio/storage/local-voice-recording-storage.provider';
import { S3VoiceRecordingStorage } from './audio/storage/s3-voice-recording-storage.provider';
import { VoiceRecordingStorageFactory } from './audio/storage/voice-recording-storage.factory';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { MockVoiceRuntimeProvider } from './runtime/mock-voice-runtime.provider';
import { OpenAIRealtimeProvider } from './runtime/openai-realtime.provider';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { VoiceController } from './voice.controller';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';

@Module({
  controllers: [VoiceController],
  providers: [
    VoiceSessionService,
    VoiceSocketRegistry,
    LocalVoiceRecordingStorage,
    S3VoiceRecordingStorage,
    VoiceRecordingStorageFactory,
    VoiceRecordingService,
    SmartfloStreamAdapter,
    MockVoiceRuntimeProvider,
    OpenAIRealtimeProvider,
    VoiceRuntimeFactory,
    AudioGateway,
  ],
  exports: [AudioGateway],
})
export class VoiceModule {}
