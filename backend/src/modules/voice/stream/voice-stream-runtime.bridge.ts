import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { CallEventType, CallStatus } from '@prisma/client';
import { analyzePcm16, formatPcm16Stats } from '../audio/pcm-stats.util';
import { isSpeechLikePcm16 } from '../audio/speech-detection.util';
import { voiceDebugLog } from '../audio/voice-debug.util';
import { VoiceRecordingService } from '../audio/voice-recording.service';
import { VoiceRuntimeFactory } from '../runtime/voice-runtime.factory';
import { VoiceSessionService } from '../voice-session.service';
import { VoiceSocketRegistry } from '../voice-socket.registry';
import { VoiceCallAuthorizationService } from '../voice-call-authorization.service';
import { VoiceOpeningConfigService } from '../voice-opening-config.service';
import { AudioGateway } from '../audio.gateway';
import { extractCallContextDebugInfo } from '../voice-call-context.util';
import { VoiceTranscriptConfigService } from '../transcript/voice-transcript-config.service';
import { VoiceTranscriptService } from '../transcript/voice-transcript.service';
import { PrismaService } from '../../../database/prisma.service';
import {
  CallTimingDiagnosticsService,
  CallTimingEvent,
} from '../call-timing-diagnostics.service';
import { IntegrationCallbackService } from '../../integrations/integration-callback.service';
import { TelephonyProvider } from '../telephony/telephony-provider.types';
import { VoiceStreamStartData } from './voice-stream.types';

/**
 * Shared voice runtime orchestration for non-Smartflo telephony adapters.
 * SmartfloStreamAdapter keeps its own inline flow unchanged.
 */
@Injectable()
export class VoiceStreamRuntimeBridge {
  private readonly logger = new Logger(VoiceStreamRuntimeBridge.name);

  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
    private readonly voiceRuntimeFactory: VoiceRuntimeFactory,
    private readonly voiceRecordingService: VoiceRecordingService,
    private readonly voiceCallAuthorizationService: VoiceCallAuthorizationService,
    private readonly voiceOpeningConfigService: VoiceOpeningConfigService,
    private readonly voiceTranscriptConfig: VoiceTranscriptConfigService,
    private readonly voiceTranscriptService: VoiceTranscriptService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AudioGateway))
    private readonly audioGateway: AudioGateway,
    private readonly callTiming: CallTimingDiagnosticsService,
    @Inject(forwardRef(() => IntegrationCallbackService))
    private readonly integrationCallbackService: IntegrationCallbackService,
  ) {}

  private get voiceRuntime() {
    return this.voiceRuntimeFactory.getProvider();
  }

  handleConnected(
    telephonyProvider: TelephonyProvider,
    socketSessionId: string,
  ): void {
    this.voiceSessionService.recordConnected(socketSessionId);
    this.logger.log({
      telephonyProvider,
      socketSessionId,
      message: `${telephonyProvider} voice stream connected`,
    });
    this.voiceRuntime.onSocketConnected?.(socketSessionId);
  }

  async authorizeAndStartRuntime(
    telephonyProvider: TelephonyProvider,
    socketSessionId: string,
    streamSid: string,
    startData: VoiceStreamStartData,
    socketQueryAuthorizationId?: string,
  ): Promise<void> {
    if (socketQueryAuthorizationId) {
      this.logger.log({
        telephonyProvider,
        socketSessionId,
        streamSid,
        authorizationId: socketQueryAuthorizationId,
        message: `${telephonyProvider} authorizing stream with WSS query authorizationId`,
      });
    }

    const authorization = await this.voiceCallAuthorizationService.authorizeStart({
      streamSid,
      callSid: startData.callSid,
      from: startData.from,
      to: startData.to,
      customParameters: startData.customParameters,
      authorizationId: socketQueryAuthorizationId,
    });

    if (!authorization.authorized) {
      this.voiceSessionService.clearAuthorizationPending(streamSid);
      this.voiceSessionService.markAppInitiated(streamSid, false, {
        rejectionReason: authorization.reason,
      });
      this.voiceSessionService.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeError: authorization.reason,
      });

      this.logger.warn({
        telephonyProvider,
        socketSessionId,
        streamSid,
        callSid: startData.callSid,
        from: startData.from,
        to: startData.to,
        authorizationId: socketQueryAuthorizationId ?? null,
        rejectionReason: authorization.reason,
        message: `${telephonyProvider} authorization failed — session preserved`,
      });
      return;
    }

    this.voiceSessionService.clearAuthorizationPending(streamSid);
    this.voiceSessionService.markAppInitiated(streamSid, true, {
      authorizationSource: authorization.source,
      authorizationId: authorization.authorizationId,
      callId: authorization.callId,
    });

    this.logger.log({
      telephonyProvider,
      socketSessionId,
      streamSid,
      callSid: startData.callSid,
      authorizationSource: authorization.source,
      authorizationId: authorization.authorizationId,
      message: `${telephonyProvider} authorization success`,
    });
    this.callTiming.markByStreamSid(
      streamSid,
      CallTimingEvent.CALL_AUTHORIZATION_LOADED,
      {
        authorizationId: authorization.authorizationId,
        authorizationSource: authorization.source,
        telephonyProvider,
      },
    );

    if (authorization.callId) {
      this.voiceTranscriptService.bindCall(streamSid, authorization.callId);
      void this.markCallInProgress(authorization.callId, startData.callSid).catch(
        (error) => {
          this.logger.warn({
            telephonyProvider,
            streamSid,
            callId: authorization.callId,
            err: error instanceof Error ? error.message : String(error),
            message: 'Failed to mark voice call in progress',
          });
        },
      );
    }

    const aiSpeakFirstEnabled = this.voiceOpeningConfigService.isSpeakFirstEnabled();
    const openingContext = aiSpeakFirstEnabled
      ? this.voiceOpeningConfigService.resolve(authorization.openingContext)
      : undefined;

    if (openingContext) {
      this.voiceSessionService.setOpeningContext(streamSid, openingContext);
    }

    const callContext = authorization.callContext;
    if (callContext) {
      this.voiceSessionService.setCallContext(streamSid, callContext);
      this.logger.log({
        telephonyProvider,
        streamSid,
        authorizationId: authorization.authorizationId,
        ...extractCallContextDebugInfo(callContext),
        message: 'voice_call_context_loaded',
      });
      this.callTiming.markByStreamSid(streamSid, CallTimingEvent.CALL_CONTEXT_LOADED, {
        hasCallContext: true,
        telephonyProvider,
      });
    } else {
      this.logger.log({
        telephonyProvider,
        streamSid,
        authorizationId: authorization.authorizationId,
        message: 'voice_call_context_missing',
      });
      this.callTiming.markByStreamSid(streamSid, CallTimingEvent.CALL_CONTEXT_LOADED, {
        hasCallContext: false,
        telephonyProvider,
      });
    }

    this.voiceSessionService.initializeSpeakFirstState(streamSid, {
      aiSpeakFirstEnabled,
      openingState: aiSpeakFirstEnabled
        ? 'waiting_for_openai_ready'
        : 'disabled',
      openingContext,
    });

    this.logger.log({
      telephonyProvider,
      socketSessionId,
      streamSid,
      callSid: startData.callSid,
      authorizationSource: authorization.source,
      authorizationId: authorization.authorizationId,
      runtimeProvider: this.voiceRuntime.name,
      VOICE_AI_SPEAK_FIRST_ENABLED: aiSpeakFirstEnabled,
      agentName: openingContext?.agentName,
      companyName: openingContext?.companyName,
      hasCallContext: Boolean(callContext),
      message:
        telephonyProvider === TelephonyProvider.EXOTEL
          ? 'Opening OpenAI Realtime WebSocket for Exotel session'
          : aiSpeakFirstEnabled
            ? 'voice_ai_speak_first_enabled'
            : `${telephonyProvider} start authorized — starting OpenAI runtime`,
    });

    this.voiceSessionService.updateRuntimeState(streamSid, {
      runtimeProvider: this.voiceRuntime.name,
      runtimeStatus: 'connecting',
    });

    void this.voiceRuntime.createSession({
      streamSid,
      socketSessionId,
      callSid: startData.callSid,
      from: startData.from,
      to: startData.to,
      direction: startData.direction,
      openingContext,
      callContext,
      aiSpeakFirstEnabled,
      smartfloStartReceived: true,
      authorized: true,
    });

    setImmediate(() => {
      this.voiceRuntime.onSocketConnected?.(socketSessionId);
    });

    setImmediate(() => {
      this.audioGateway.sendSyntheticTone(streamSid);
    });
  }

  handleInboundPcm16(
    telephonyProvider: TelephonyProvider,
    socketSessionId: string,
    streamSid: string,
    pcm16Audio: Buffer,
    options?: {
      recordingInboundMulawBase64?: string;
      logLabel?: string;
    },
  ): void {
    if (!this.voiceSessionService.isAppInitiatedStream(streamSid)) {
      return;
    }

    if (pcm16Audio.length === 0) {
      return;
    }

    try {
      const pcmStats = analyzePcm16(pcm16Audio);
      const now = new Date();
      const speechLike = isSpeechLikePcm16(pcm16Audio);

      voiceDebugLog(this.logger, streamSid, `${telephonyProvider}_media`, {
        decodedSamples: Math.floor(pcm16Audio.length / 2),
        rms: Number(pcmStats.rms.toFixed(2)),
        silence: speechLike ? 0 : 1,
      });

      this.logger.debug({
        telephonyProvider,
        streamSid,
        pcmStats: formatPcm16Stats(pcmStats),
        message: options?.logLabel ?? `Inbound ${telephonyProvider} PCM16 chunk`,
      });

      this.voiceSessionService.recordInboundAudioStats(streamSid, pcmStats);
      this.voiceSessionService.updateRuntimeState(streamSid, {
        hasReceivedCallerAudio: true,
        lastCallerAudioAt: now,
        lastMediaAt: now,
        ...(speechLike
          ? {
              lastSpeechLikeAudioAt: now,
              incrementSpeechLikeFrame: true,
            }
          : { incrementSilenceFrame: true }),
      });

      this.voiceRuntime.handleAudio(streamSid, pcm16Audio);
    } catch (error) {
      this.logger.warn({
        telephonyProvider,
        streamSid,
        err: error,
        message: 'Failed to process inbound media for runtime provider',
      });
    }

    if (options?.recordingInboundMulawBase64) {
      try {
        this.voiceRecordingService.appendInboundMulawBase64(
          streamSid,
          options.recordingInboundMulawBase64,
        );
      } catch (error) {
        voiceDebugLog(this.logger, streamSid, 'recording_error', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.warn({
          telephonyProvider,
          streamSid,
          err: error,
          message: 'Recording append failed; live audio path unaffected',
        });
      }
    }
  }

  async endRuntimeForStream(streamSid: string): Promise<void> {
    try {
      await this.voiceRuntime.endSession(streamSid);
    } catch (error) {
      this.logger.error({ streamSid, err: error }, 'Failed to end voice runtime session');
    }
  }

  async finalizeRecordingForStreamAsync(
    telephonyProvider: TelephonyProvider,
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    if (!this.voiceSessionService.isAppInitiatedStream(streamSid)) {
      await this.endRuntimeForStream(streamSid);
      return;
    }

    await this.endRuntimeForStream(streamSid);
    await this.finalizeRecording(telephonyProvider, streamSid, callSid);
  }

  async finalizeOnStop(
    telephonyProvider: TelephonyProvider,
    socketSessionId: string,
    streamSid: string,
    callSid: string | undefined,
    stopReason: string | null,
  ): Promise<void> {
    const appInitiated = this.voiceSessionService.isAppInitiatedStream(streamSid);

    if (appInitiated) {
      await this.endRuntimeForStream(streamSid);
      await this.finalizeRecording(telephonyProvider, streamSid, callSid);
    }

    this.voiceSessionService.endByStreamSid(streamSid, stopReason);
    this.voiceSocketRegistry.removeByStreamSid(streamSid);

    this.logger.log({
      telephonyProvider,
      socketSessionId,
      streamSid,
      stopReason,
      appInitiated,
      message: appInitiated
        ? `${telephonyProvider} stop event — finalizing voice session`
        : `${telephonyProvider} stop event — session moved to Recent Ended`,
    });
  }

  private async finalizeRecording(
    telephonyProvider: TelephonyProvider,
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    try {
      const session = this.voiceSessionService.getByStreamSid(streamSid);
      const callId = session?.callId;
      const metadata = await this.voiceRecordingService.finalize(
        streamSid,
        callSid,
        {
          includeSpeakerTracks: this.voiceTranscriptConfig.isPostCallEnabled(),
          callId,
        },
      );
      if (!metadata) {
        return;
      }

      this.voiceSessionService.attachRecordingMetadata(streamSid, {
        fileName: metadata.fileName,
        durationMsEstimate: metadata.durationMsEstimate,
        mulawBytes: metadata.mulawBytes,
        wavBytes: metadata.wavBytes,
        recordingS3Url: metadata.s3Key ?? metadata.storageKey,
        inboundTimelineStartMs: metadata.inboundTimelineStartMs,
        inboundTimelineEndMs: metadata.inboundTimelineEndMs,
        outboundTimelineStartMs: metadata.outboundTimelineStartMs,
        outboundTimelineEndMs: metadata.outboundTimelineEndMs,
        inboundChunkCount: metadata.inboundChunkCount,
        outboundChunkCount: metadata.outboundChunkCount,
      });

      this.logger.log({
        telephonyProvider,
        streamSid,
        fileName: metadata.fileName,
        mulawBytes: metadata.mulawBytes,
        durationMsEstimate: metadata.durationMsEstimate,
        message: 'Voice recording generated',
      });

      if (callId) {
        try {
          await this.markCallCompleted(callId, metadata.durationMsEstimate);
        } catch (error) {
          this.logger.warn({
            telephonyProvider,
            streamSid,
            callId,
            err: error instanceof Error ? error.message : String(error),
            message: 'Failed to mark voice call completed',
          });
        }
      }
      if (callId && this.voiceTranscriptConfig.isPostCallEnabled()) {
        void this.voiceTranscriptService
          .enqueuePostCallTranscription({
            callId,
            streamSid,
            mixedStorageKey: metadata.storageKey,
            inboundStorageKey: metadata.inboundStorageKey,
            outboundStorageKey: metadata.outboundStorageKey,
            durationMsEstimate: metadata.durationMsEstimate,
          })
          .catch((error) => {
            this.logger.error(
              { telephonyProvider, streamSid, callId, err: error },
              'Failed to enqueue post-call transcription',
            );
          });
      } else if (callId) {
        void this.deliverIntegrationCallResult(
          callId,
          streamSid,
          metadata.durationMsEstimate,
        ).catch((error) => {
          this.logger.error(
            { telephonyProvider, streamSid, callId, err: error },
            'Failed to deliver integration call result',
          );
        });
      }
    } catch (error) {
      this.logger.error(
        { telephonyProvider, streamSid, err: error },
        'Failed to finalize voice recording',
      );
    }
  }

  private async markCallInProgress(
    callId: string,
    providerRef?: string,
  ): Promise<void> {
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.in_progress,
        startedAt: new Date(),
        providerRef,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId,
        type: CallEventType.status_change,
        payload: {
          status: CallStatus.in_progress,
          providerRef: providerRef ?? null,
        },
      },
    });
  }

  private async markCallCompleted(
    callId: string,
    durationMsEstimate?: number,
  ): Promise<void> {
    const endedAt = new Date();
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.completed,
        endedAt,
        durationSec:
          typeof durationMsEstimate === 'number'
            ? Math.max(0, Math.round(durationMsEstimate / 1000))
            : undefined,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId,
        type: CallEventType.status_change,
        payload: {
          status: CallStatus.completed,
          durationMsEstimate: durationMsEstimate ?? null,
        },
      },
    });

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (call) {
      void this.integrationCallbackService
        .notifyStatusChange(call)
        .catch((error) => {
          this.logger.warn({
            callId,
            err: error instanceof Error ? error.message : String(error),
            message: 'Failed to send integration status webhook',
          });
        });
    }
  }

  private async deliverIntegrationCallResult(
    callId: string,
    streamSid: string,
    durationMsEstimate?: number,
  ): Promise<void> {
    await this.voiceTranscriptService.finalizeLiveTranscriptForCall(
      callId,
      streamSid,
    );
    await this.integrationCallbackService.notifyCallResultReady(
      callId,
      streamSid,
      durationMsEstimate,
    );
  }
}
