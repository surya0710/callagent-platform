import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainingModule } from '../training/training.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AudioGateway } from './audio.gateway';
import { S3RecordingStorageService } from './audio/s3-recording-storage.service';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceAudioConfigService } from './audio/voice-audio-config.service';
import { MockVoiceRuntimeProvider } from './runtime/mock-voice-runtime.provider';
import { OpenAIRealtimeProvider } from './runtime/openai-realtime.provider';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import { VoiceOpeningConfigService } from './voice-opening-config.service';
import { SmartfloClickToCallService } from './smartflo-click-to-call.service';
import { TelephonyOutboundCallService } from './telephony/telephony-outbound-call.service';
import { TelephonyProviderConfigService } from './telephony/telephony-provider.config';
import { SmartfloStreamAdapter } from './smartflo-stream.adapter';
import { CallTimingDiagnosticsService } from './call-timing-diagnostics.service';
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
import { TranscriptEmailService } from './transcript-email.service';
import { VoiceTranscriptEmailController } from './voice-transcript-email.controller';

@Module({
  imports: [NotificationsModule, TrainingModule, forwardRef(() => IntegrationsModule)],
  controllers: [VoiceController, VoiceTestCallController, VoiceTranscriptEmailController],
  providers: [
    CallTimingDiagnosticsService,
    VoiceSharedStateService,
    VoiceSessionService,
    VoiceSocketRegistry,
    S3RecordingStorageService,
    VoiceRecordingService,
    VoiceAudioConfigService,
    TelephonyProviderConfigService,
    TelephonyOutboundCallService,
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
    TranscriptEmailService,
  ],
  exports: [
    AudioGateway,
    VoiceCallAuthorizationService,
    VoiceTranscriptService,
    TranscriptEmailService,
    SmartfloClickToCallService,
    TelephonyOutboundCallService,
  ],
})
export class VoiceModule {}
