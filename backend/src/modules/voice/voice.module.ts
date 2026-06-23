import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainingModule } from '../training/training.module';
import { AudioGateway } from './audio.gateway';
import { LocalVoiceRecordingStorage } from './audio/storage/local-voice-recording-storage.provider';
import { S3VoiceRecordingStorage } from './audio/storage/s3-voice-recording-storage.provider';
import { VoiceRecordingStorageFactory } from './audio/storage/voice-recording-storage.factory';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceAudioConfigService } from './audio/voice-audio-config.service';
import { MockVoiceRuntimeProvider } from './runtime/mock-voice-runtime.provider';
import { OpenAIRealtimeProvider } from './runtime/openai-realtime.provider';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import { VoiceOpeningConfigService } from './voice-opening-config.service';
import { SmartfloClickToCallService } from './smartflo-click-to-call.service';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { VoiceCallAuthorizationService } from './voice-call-authorization.service';
import { VoiceSharedStateService } from './voice-shared-state.service';
import { VoiceController } from './voice.controller';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';
import { VoiceTestCallController } from './voice-test-call.controller';
import { VoiceTranscriptConfigService } from './transcript/voice-transcript-config.service';
import { VoiceTranscriptPostCallService } from './transcript/voice-transcript-postcall.service';
import { VoiceTranscriptPostProcessService } from './transcript/voice-transcript-postprocess.service';
import { VoiceTranscriptService } from './transcript/voice-transcript.service';
import { VoiceRecordingPathService } from './transcript/voice-recording-path.service';
import { TranscriptEmailService } from './transcript-email.service';
import { VoiceTranscriptEmailController } from './voice-transcript-email.controller';

@Module({
  imports: [NotificationsModule, TrainingModule],
  controllers: [VoiceController, VoiceTestCallController, VoiceTranscriptEmailController],
  providers: [
    VoiceSharedStateService,
    VoiceSessionService,
    VoiceSocketRegistry,
    LocalVoiceRecordingStorage,
    S3VoiceRecordingStorage,
    VoiceRecordingStorageFactory,
    VoiceRecordingService,
    VoiceAudioConfigService,
    SmartfloClickToCallService,
    SmartfloStreamAdapter,
    VoiceCallAuthorizationService,
    VoiceOpeningConfigService,
    MockVoiceRuntimeProvider,
    OpenAIRealtimeProvider,
    VoiceRuntimeFactory,
    AudioGateway,
    VoiceTranscriptConfigService,
    VoiceTranscriptPostCallService,
    VoiceTranscriptPostProcessService,
    VoiceTranscriptService,
    VoiceRecordingPathService,
    TranscriptEmailService,
  ],
  exports: [
    AudioGateway,
    VoiceCallAuthorizationService,
    VoiceTranscriptService,
    TranscriptEmailService,
  ],
})
export class VoiceModule {}
