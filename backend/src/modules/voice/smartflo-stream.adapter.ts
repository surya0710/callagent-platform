import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { CallEventType, CallStatus } from '@prisma/client';
import { decodeMulawBuffer } from './audio/mulaw-codec';
import { analyzePcm16, formatPcm16Stats } from './audio/pcm-stats.util';
import { isSpeechLikePcm16 } from './audio/speech-detection.util';
import { voiceDebugLog } from './audio/voice-debug.util';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import { parseSmartfloInboundMedia } from './smartflo-media.util';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSocketRegistry } from './voice-socket.registry';
import { VoiceCallAuthorizationService } from './voice-call-authorization.service';
import { VoiceOpeningConfigService } from './voice-opening-config.service';
import { AudioGateway } from './audio.gateway';
import { CallContext } from './voice-call-context.types';
import { extractCallContextDebugInfo } from './voice-call-context.util';
import { VoiceTranscriptConfigService } from './transcript/voice-transcript-config.service';
import { VoiceTranscriptService } from './transcript/voice-transcript.service';
import { PrismaService } from '../../database/prisma.service';
import {
  CallTimingDiagnosticsService,
  CallTimingEvent,
} from './call-timing-diagnostics.service';
import { normalizeVoicePhoneNumber } from './voice-phone.util';
import { IntegrationCallbackService } from '../integrations/integration-callback.service';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

@Injectable()
export class SmartfloStreamAdapter {
  private readonly logger = new Logger(SmartfloStreamAdapter.name);
  private readonly loggedMediaShapeByStreamSid = new Set<string>();
  private readonly loggedInboundDecodeByStreamSid = new Set<string>();

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

  handleMessage(socketSessionId: string, raw: string): void {
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.logger.warn({
        socketSessionId,
        message: 'Invalid JSON in WebSocket message',
      });
      return;
    }

    const event = payload.event;
    if (typeof event !== 'string') {
      this.logger.warn({
        socketSessionId,
        message: 'Missing or invalid event field',
      });
      return;
    }

    switch (event) {
      case 'connected':
        this.handleConnected(socketSessionId, payload);
        break;
      case 'start':
        void this.handleStart(socketSessionId, payload);
        break;
      case 'media':
        this.handleMedia(socketSessionId, payload);
        break;
      case 'dtmf':
        this.handleDtmf(socketSessionId, payload);
        break;
      case 'mark':
        this.handleMark(socketSessionId, payload);
        break;
      case 'clear':
        this.handleClear(socketSessionId, payload);
        break;
      case 'stop':
        this.handleStop(socketSessionId, payload);
        break;
      default:
        this.logger.warn({
          socketSessionId,
          message: `Unknown Smartflo event: ${event}`,
        });
    }
  }

  private handleConnected(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    this.voiceSessionService.recordConnected(socketSessionId);
    this.logger.log({
      socketSessionId,
      smartfloEvent: 'connected',
      message: 'voice stream connected',
    });
    this.voiceRuntime.onSocketConnected?.(socketSessionId);
  }

  private async handleStart(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const start = asRecord(payload.start) ?? {};
    const streamSid =
      (typeof start.streamSid === 'string' ? start.streamSid : undefined) ??
      (typeof payload.streamSid === 'string' ? payload.streamSid : undefined);

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Start event missing streamSid',
      });
      return;
    }

    const startData = {
      streamSid,
      callSid: typeof start.callSid === 'string' ? start.callSid : undefined,
      accountSid:
        typeof start.accountSid === 'string' ? start.accountSid : undefined,
      from: typeof start.from === 'string' ? start.from : undefined,
      to: typeof start.to === 'string' ? start.to : undefined,
      direction:
        typeof start.direction === 'string' ? start.direction : undefined,
      mediaFormat: start.mediaFormat,
      customParameters: start.customParameters,
    };

    const boundSession = this.voiceSessionService.bindStreamSid(
      socketSessionId,
      startData,
    );
    if (boundSession) {
      boundSession.telephonyProvider = 'smartflo';
    }
    this.voiceSocketRegistry.bindStreamSid(socketSessionId, streamSid);
    this.voiceSessionService.markAuthorizationPending(streamSid);
    this.voiceRecordingService.start(streamSid, startData.callSid);

    const linkedPhone = [startData.to, startData.from]
      .map((value) =>
        value ? normalizeVoicePhoneNumber(value) : undefined,
      )
      .find((value): value is string => Boolean(value));
    if (linkedPhone) {
      this.callTiming.linkStreamSid(streamSid, `phone:${linkedPhone}`);
    }
    if (startData.callSid) {
      this.callTiming.linkStreamSid(streamSid, `callSid:${startData.callSid}`);
    }
    this.callTiming.linkAlias(
      `socket:${socketSessionId}`,
      linkedPhone ? `phone:${linkedPhone}` : `streamSid:${streamSid}`,
    );
    this.callTiming.markByStreamSid(streamSid, CallTimingEvent.SMARTFLO_START_RECEIVED, {
      callSid: startData.callSid,
      from: startData.from,
      to: startData.to,
    });

    await this.authorizeAndStartRuntime(socketSessionId, streamSid, startData);
  }

  private async authorizeAndStartRuntime(
    socketSessionId: string,
    streamSid: string,
    startData: {
      streamSid: string;
      callSid?: string;
      accountSid?: string;
      from?: string;
      to?: string;
      direction?: string;
      mediaFormat?: unknown;
      customParameters?: unknown;
    },
  ): Promise<void> {
    const authorization = await this.voiceCallAuthorizationService.authorizeStart({
      streamSid,
      callSid: startData.callSid,
      from: startData.from,
      to: startData.to,
      customParameters: startData.customParameters,
    });

    if (!authorization.authorized) {
      this.voiceSessionService.clearAuthorizationPending(streamSid);
      this.voiceSessionService.markAppInitiated(streamSid, false, {
        rejectionReason: authorization.reason,
      });

      this.logger.warn({
        socketSessionId,
        streamSid,
        callSid: startData.callSid,
        from: startData.from,
        to: startData.to,
        reason: authorization.reason,
        message:
          'Smartflo stream rejected — skipping OpenAI runtime and recording (not app-initiated)',
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
      socketSessionId,
      streamSid,
      callSid: startData.callSid,
      authorizationSource: authorization.source,
      authorizationId: authorization.authorizationId,
      message: 'authorization success',
    });
    this.callTiming.markByStreamSid(
      streamSid,
      CallTimingEvent.CALL_AUTHORIZATION_LOADED,
      {
        authorizationId: authorization.authorizationId,
        authorizationSource: authorization.source,
      },
    );

    if (authorization.callId) {
      this.voiceTranscriptService.bindCall(streamSid, authorization.callId);
      void this.markCallInProgress(authorization.callId, startData.callSid).catch(
        (error) => {
          this.logger.warn({
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
        streamSid,
        authorizationId: authorization.authorizationId,
        ...extractCallContextDebugInfo(callContext),
        message: 'voice_call_context_loaded',
      });
      this.callTiming.markByStreamSid(streamSid, CallTimingEvent.CALL_CONTEXT_LOADED, {
        hasCallContext: true,
      });
    } else {
      this.logger.log({
        streamSid,
        authorizationId: authorization.authorizationId,
        message: 'voice_call_context_missing',
      });
      this.callTiming.markByStreamSid(streamSid, CallTimingEvent.CALL_CONTEXT_LOADED, {
        hasCallContext: false,
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
      message: aiSpeakFirstEnabled
        ? 'voice_ai_speak_first_enabled'
        : 'Smartflo start authorized — starting OpenAI runtime and recording',
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

  private handleMedia(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Media event received before streamSid binding',
      });
      return;
    }

    if (!this.voiceSessionService.isAppInitiatedStream(streamSid)) {
      return;
    }

    const parsed = parseSmartfloInboundMedia(payload);
    const payloadStr = parsed.payloadBase64;

    if (!this.loggedMediaShapeByStreamSid.has(streamSid)) {
      this.loggedMediaShapeByStreamSid.add(streamSid);
      this.logger.log({
        streamSid,
        parseSource: parsed.parseSource,
        track: parsed.track,
        chunk: parsed.chunk,
        timestamp: parsed.timestamp,
        payloadByteLength: parsed.payloadByteLength,
        topLevelStreamSid: typeof payload.streamSid === 'string',
        message: 'First inbound Smartflo media event shape',
      });
    }

    this.voiceSessionService.recordMedia(socketSessionId, payload);

    if (payloadStr) {
      try {
        const mulawBuffer = Buffer.from(payloadStr, 'base64');
        if (mulawBuffer.length > 0) {
          const pcm16Audio = decodeMulawBuffer(mulawBuffer);
          const pcmStats = analyzePcm16(pcm16Audio);
          const now = new Date();
          const speechLike = isSpeechLikePcm16(pcm16Audio);

          voiceDebugLog(this.logger, streamSid, 'smartflo_media', {
            payloadBytes: mulawBuffer.length,
            decodedSamples: Math.floor(pcm16Audio.length / 2),
            rms: Number(pcmStats.rms.toFixed(2)),
            silence: speechLike ? 0 : 1,
            track: parsed.track,
          });

          if (!this.loggedInboundDecodeByStreamSid.has(streamSid)) {
            this.loggedInboundDecodeByStreamSid.add(streamSid);
            this.logger.log({
              streamSid,
              mulawBytes: mulawBuffer.length,
              pcmStats: formatPcm16Stats(pcmStats),
              track: parsed.track,
              message: 'Inbound μ-law decode stats (first chunk)',
            });
          }

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
        }
      } catch (error) {
        this.logger.warn({
          streamSid,
          err: error,
          message: 'Failed to decode inbound media for runtime provider',
        });
      }

      try {
        this.voiceRecordingService.appendInboundMulawBase64(streamSid, payloadStr);
      } catch (error) {
        voiceDebugLog(this.logger, streamSid, 'recording_error', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.warn({
          streamSid,
          err: error,
          message: 'Recording append failed; live audio path unaffected',
        });
      }
    } else if (parsed.parseSource === 'none') {
      this.logger.warn({
        streamSid,
        track: parsed.track,
        message: 'Media event missing payload — check Smartflo payload shape',
        payloadKeys: Object.keys(payload),
        mediaKeys:
          payload.media && typeof payload.media === 'object'
            ? Object.keys(payload.media as Record<string, unknown>)
            : [],
      });
    }
  }

  private handleDtmf(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'DTMF event received before streamSid binding',
      });
      return;
    }

    this.voiceSessionService.recordDtmf(socketSessionId, payload);
  }

  private handleMark(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Mark event received before streamSid binding',
      });
      return;
    }

    this.voiceSessionService.recordMark(socketSessionId, payload);
  }

  private handleClear(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Clear event received before streamSid binding',
      });
      return;
    }

    this.voiceSessionService.recordClear(socketSessionId, payload);
  }

  private handleStop(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const streamSid = this.voiceSessionService.resolveStreamSid(
      payload.streamSid,
      socketSessionId,
    );

    if (!streamSid) {
      this.logger.warn({
        socketSessionId,
        message: 'Stop event received before streamSid binding',
      });
      return;
    }

    const stop = asRecord(payload.stop);
    const stopReason =
      typeof stop?.reason === 'string' ? stop.reason : null;

    void this.finalizeAndEndOnStop(
      socketSessionId,
      streamSid,
      (typeof stop?.callSid === 'string' ? stop.callSid : undefined) ??
        this.voiceSessionService.getByStreamSid(streamSid)?.callSid,
      stopReason,
    );
  }

  async endRuntimeForStream(streamSid: string): Promise<void> {
    try {
      await this.voiceRuntime.endSession(streamSid);
    } catch (error) {
      this.logger.error(
        { streamSid, err: error },
        'Failed to end voice runtime session',
      );
    }
  }

  finalizeRecordingForStream(
    streamSid: string,
    callSid?: string,
  ): void {
    void this.finalizeRecording(streamSid, callSid);
  }

  async finalizeRecordingForStreamAsync(
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    if (!this.voiceSessionService.isAppInitiatedStream(streamSid)) {
      await this.endRuntimeForStream(streamSid);
      return;
    }

    await this.endRuntimeForStream(streamSid);
    await this.finalizeRecording(streamSid, callSid);
  }

  private async finalizeAndEndOnStop(
    socketSessionId: string,
    streamSid: string,
    callSid: string | undefined,
    stopReason: string | null,
  ): Promise<void> {
    const appInitiated = this.voiceSessionService.isAppInitiatedStream(streamSid);

    if (appInitiated) {
      await this.endRuntimeForStream(streamSid);
      await this.finalizeRecording(streamSid, callSid);
    }

    this.voiceSessionService.endByStreamSid(streamSid, stopReason);
    this.voiceSocketRegistry.removeByStreamSid(streamSid);

    this.logger.log({
      socketSessionId,
      streamSid,
      stopReason,
      appInitiated,
      message: appInitiated
        ? 'Smartflo stop event received — finalizing voice session'
        : 'Smartflo stop event received — discarded unauthorized stream',
    });
  }

  private async finalizeRecording(
    streamSid: string,
    callSid?: string,
  ): Promise<void> {
    try {
      const metadata = await this.voiceRecordingService.finalize(
        streamSid,
        callSid,
        {
          includeSpeakerTracks: this.voiceTranscriptConfig.isPostCallEnabled(),
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
        inboundTimelineStartMs: metadata.inboundTimelineStartMs,
        inboundTimelineEndMs: metadata.inboundTimelineEndMs,
        outboundTimelineStartMs: metadata.outboundTimelineStartMs,
        outboundTimelineEndMs: metadata.outboundTimelineEndMs,
        inboundChunkCount: metadata.inboundChunkCount,
        outboundChunkCount: metadata.outboundChunkCount,
      });

      this.logger.log({
        streamSid,
        fileName: metadata.fileName,
        mulawBytes: metadata.mulawBytes,
        pcmBytes: metadata.pcmBytes,
        chunks: metadata.chunks,
        durationMsEstimate: metadata.durationMsEstimate,
        inboundTimelineStartMs: metadata.inboundTimelineStartMs,
        inboundTimelineEndMs: metadata.inboundTimelineEndMs,
        outboundTimelineStartMs: metadata.outboundTimelineStartMs,
        outboundTimelineEndMs: metadata.outboundTimelineEndMs,
        message: 'Voice recording generated',
      });

      const session = this.voiceSessionService.getByStreamSid(streamSid);
      const callId = session?.callId;
      if (callId) {
        try {
          await this.markCallCompleted(callId, metadata.durationMsEstimate);
        } catch (error) {
          this.logger.warn({
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
              { streamSid, callId, err: error },
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
            { streamSid, callId, err: error },
            'Failed to deliver integration call result',
          );
        });
      }
    } catch (error) {
      this.logger.error(
        { streamSid, err: error },
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
