import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { buildServerOriginInfo } from '../../common/server-origin.util';
import { ConfigService } from '@nestjs/config';
import { VoiceRuntimeType } from '../../config/env.validation';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import { VoiceAudioConfigService } from './audio/voice-audio-config.service';
import { VoiceCallAuthorizationService } from './voice-call-authorization.service';
import { VoiceSharedStateService } from './voice-shared-state.service';
import {
  toVoiceSessionResponse,
  VoiceSessionService,
} from './voice-session.service';
import { VoiceTranscriptService } from './transcript/voice-transcript.service';
import { PrismaService } from '../../database/prisma.service';
import { VoiceSessionQueryDto } from './dto/voice-session-query.dto';

@ApiTags('Voice')
@Public()
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceRecordingService: VoiceRecordingService,
    private readonly configService: ConfigService,
    private readonly voiceRuntimeFactory: VoiceRuntimeFactory,
    private readonly voiceAudioConfigService: VoiceAudioConfigService,
    private readonly voiceCallAuthorizationService: VoiceCallAuthorizationService,
    private readonly voiceSharedStateService: VoiceSharedStateService,
    private readonly voiceTranscriptService: VoiceTranscriptService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('sessions')
  @ApiOperation({ summary: 'List active and recently ended voice sessions' })
  async listSessions(@Query() query: VoiceSessionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const recentEnded = await this.voiceSessionService.getRecentEndedSessions();
    const total = recentEnded.length;
    const skip = (page - 1) * limit;
    const pageItems = recentEnded.slice(skip, skip + limit);
    const recentEndedWithS3 = await this.enrichRecordingAvailability(
      pageItems.map(toVoiceSessionResponse),
    );
    return {
      active: this.voiceSessionService
        .getActiveSessions()
        .map(toVoiceSessionResponse),
      recentEnded: recentEndedWithS3,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  @Get('sessions/active')
  @ApiOperation({ summary: 'List active voice sessions' })
  listActiveSessions() {
    return this.voiceSessionService
      .getActiveSessions()
      .map(toVoiceSessionResponse);
  }

  @Get('sessions/recent')
  @ApiOperation({ summary: 'List recently ended voice sessions' })
  async listRecentSessions(@Query() query: VoiceSessionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const recentEnded = await this.voiceSessionService.getRecentEndedSessions();
    const total = recentEnded.length;
    const skip = (page - 1) * limit;
    const pageItems = recentEnded.slice(skip, skip + limit);
    const data = await this.enrichRecordingAvailability(
      pageItems.map(toVoiceSessionResponse),
    );
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private async enrichRecordingAvailability(
    sessions: ReturnType<typeof toVoiceSessionResponse>[],
  ): Promise<ReturnType<typeof toVoiceSessionResponse>[]> {
    const callIds = sessions
      .map((s) => s.callId)
      .filter((id): id is string => Boolean(id));

    if (callIds.length === 0) {
      return sessions;
    }

    const calls = await this.prisma.call.findMany({
      where: { id: { in: callIds }, recordingS3Url: { not: null } },
      select: { id: true },
    });

    const callIdsWithRecording = new Set(calls.map((c) => c.id));

    return sessions.map((s) => ({
      ...s,
      recordingAvailable:
        s.recordingAvailable ||
        (s.callId ? callIdsWithRecording.has(s.callId) : false),
      recordingS3Url: null,
    }));
  }

  @Get('sessions/:streamSid/runtime-debug')
  @ApiOperation({ summary: 'Runtime debug snapshot for a voice session' })
  async getRuntimeDebug(@Param('streamSid') streamSid: string) {
    const session = await this.voiceSessionService.resolveByStreamSid(streamSid);
    if (!session) {
      throw new NotFoundException(`Voice session not found: ${streamSid}`);
    }

    const response = toVoiceSessionResponse(session);

    return {
      streamSid,
      connectedAt: response.connectedAt,
      startedAt: response.startedAt ?? null,
      lastMediaAt: response.lastMediaAt ?? null,
      runtimeStatus: response.runtimeStatus ?? 'idle',
      runtimeProvider: response.runtimeProvider,
      runtimeError: response.runtimeError ?? null,
      activePlaybookId: response.activePlaybookId ?? null,
      activePlaybookVersion: response.activePlaybookVersion ?? null,
      playbookInjected: response.playbookInjected ?? false,
      playbookLoadError: response.playbookLoadError ?? null,
      activeInstructionsMode: response.activeInstructionsMode ?? null,
      openingCompletedAt: response.openingCompletedAt ?? null,
      inboundSuppressedCount: response.inboundSuppressedCount ?? 0,
      inboundSuppressedReason: response.inboundSuppressedReason ?? null,
      postOpeningIgnoreUntil: response.postOpeningIgnoreUntil ?? null,
      speechLikePacketCount: response.speechLikePacketCount ?? 0,
      silencePacketCount: response.silencePacketCount ?? 0,
      ignoredNoisePacketCount: response.ignoredNoisePacketCount ?? 0,
      ignoredSpeechPacketCount: response.ignoredSpeechPacketCount ?? 0,
      detectedCustomerLanguage: response.detectedCustomerLanguage ?? null,
      lastCustomerLanguage: response.lastCustomerLanguage ?? null,
      preferredLanguage: response.preferredLanguage ?? null,
      responseLanguage: response.responseLanguage ?? null,
      languageMatchMode: response.languageMatchMode ?? null,
      firstCustomerSpeechAt: response.firstCustomerSpeechAt ?? null,
      firstResponseCreateAt: response.firstResponseCreateAt ?? null,
      startupListenDelayMs: response.startupListenDelayMs ?? null,
      autoReplyBlockedCount: response.autoReplyBlockedCount ?? 0,
      responseBlockedReason: response.responseBlockedReason ?? null,
      isOpenAiConnected: response.isOpenAiConnected ?? false,
      hasReceivedCallerAudio: response.hasReceivedCallerAudio ?? false,
      lastCallerAudioAt: response.lastCallerAudioAt ?? null,
      lastOpenAiAppendAt: response.lastOpenAiAppendAt ?? null,
      lastSpeechStartedAt: response.lastSpeechStartedAt ?? null,
      lastSpeechStoppedAt: response.lastSpeechStoppedAt ?? null,
      lastCommitAt: response.lastCommitAt ?? null,
      lastResponseCreateAt: response.lastResponseCreateAt ?? null,
      lastResponseDoneAt: response.lastResponseDoneAt ?? null,
      lastOpenAiAudioDoneAt: response.lastOpenAiAudioDoneAt ?? null,
      lastSpeechLikeAudioAt: response.lastSpeechLikeAudioAt ?? null,
      isAwaitingOpenAiResponse: response.isAwaitingOpenAiResponse ?? false,
      isAiSpeaking: response.isAiSpeaking ?? false,
      lastOpenAiAudioAt: response.lastOpenAiAudioAt ?? null,
      responseCount: response.responseCount ?? 0,
      responseCreateCount: response.responseCreateCount ?? 0,
      responseDoneCount: response.responseDoneCount ?? 0,
      appendCount: response.appendCount ?? 0,
      commitCount: response.commitCount ?? 0,
      outboundMediaCount: response.outboundMediaCount ?? 0,
      manualFallbackCommitCount: response.manualFallbackCommitCount ?? 0,
      speechLikeFrameCount: response.speechLikeFrameCount ?? 0,
      silenceFrameCount: response.silenceFrameCount ?? 0,
      responsePending: response.responsePending ?? false,
      lastOpenAiEvent: response.lastOpenAiEvent ?? null,
      lastError: response.lastError ?? null,
      inboundPacketsReceived: response.packetsReceived,
      openAiEventCounts: response.openAiEventCounts ?? {},
      sessionStatus: response.status,
      lastEvent: response.lastEvent ?? null,
      recordingAvailable: response.recordingAvailable ?? false,
      recordingDurationMsEstimate: response.recordingDurationMsEstimate ?? null,
      recordingMulawBytes: response.recordingMulawBytes ?? null,
      lastMediaPayloadLength: response.lastMediaPayloadLength ?? null,
      lastMediaChunk: response.lastMediaChunk ?? null,
      audioGainApplied: response.audioGainApplied ?? 1,
      inboundPeakAmplitude: response.inboundPeakAmplitude ?? null,
      inboundAvgAmplitude: response.inboundAvgAmplitude ?? null,
      inboundRms: response.inboundRms ?? null,
      outboundPeakAmplitude: response.outboundPeakAmplitude ?? null,
      outboundAvgAmplitude: response.outboundAvgAmplitude ?? null,
      outboundRms: response.outboundRms ?? null,
      outboundBytesSent: response.outboundBytesSent ?? 0,
      outboundBufferedBytes: response.outboundBufferedBytes ?? null,
      outboundFinalFlushAt: response.outboundFinalFlushAt ?? null,
      outboundFirstSentAt: response.outboundFirstSentAt ?? null,
      outboundLastSentAt: response.outboundLastSentAt ?? null,
      outboundChunkMinBytes: response.outboundChunkMinBytes ?? null,
      outboundChunkMaxBytes: response.outboundChunkMaxBytes ?? null,
      outboundChunkAvgBytes: response.outboundChunkAvgBytes ?? null,
      smartfloWsReadyState: response.smartfloWsReadyState ?? null,
      smartfloSendErrors: response.smartfloSendErrors ?? 0,
      lastSmartfloSendAt: response.lastSmartfloSendAt ?? null,
      openingContext: response.openingContext ?? null,
      aiSpeakFirstEnabled: response.aiSpeakFirstEnabled ?? false,
      openingState: response.openingState ?? null,
      openingRequestedAt: response.openingRequestedAt ?? null,
      openingResponseCreatedAt: response.openingResponseCreatedAt ?? null,
      openingAudioStartedAt: response.openingAudioStartedAt ?? null,
      openingAudioDoneAt: response.openingAudioDoneAt ?? null,
      openingDoneAt: response.openingDoneAt ?? null,
      openingError: response.openingError ?? null,
      normalModeActivatedAt: response.normalModeActivatedAt ?? null,
      openingSuppressedInboundPackets:
        response.openingSuppressedInboundPackets ?? 0,
      openingGreetingRequestedAt: response.openingGreetingRequestedAt ?? null,
      openingGreetingResponseCreatedAt:
        response.openingGreetingResponseCreatedAt ?? null,
      openingGreetingError: response.openingGreetingError ?? null,
      hasCallContext: response.hasCallContext ?? false,
      callContextKeys: response.callContextKeys ?? [],
      bookingNumber: response.callContextBookingNumber ?? null,
      customerName: response.callContextCustomerName ?? null,
      callEndDetected: response.callEndDetected ?? false,
      callEndReason: response.callEndReason ?? null,
      callEndScheduledAt: response.callEndScheduledAt ?? null,
      callEndCloseAt: response.callEndCloseAt ?? null,
      callEndCloseError: response.callEndCloseError ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('sessions/:streamSid')
  @ApiOperation({ summary: 'Get a voice session by streamSid' })
  async getSessionByStreamSid(@Param('streamSid') streamSid: string) {
    const session = await this.voiceSessionService.resolveByStreamSid(streamSid);
    if (!session) {
      throw new NotFoundException(`Voice session not found: ${streamSid}`);
    }

    return toVoiceSessionResponse(session);
  }

  @Get('sessions/:streamSid/transcript')
  @ApiOperation({ summary: 'Get draft or final transcript for a voice session' })
  async getSessionTranscript(@Param('streamSid') streamSid: string) {
    const session = await this.voiceSessionService.resolveByStreamSid(streamSid);
    if (!session) {
      throw new NotFoundException(`Voice session not found: ${streamSid}`);
    }

    if (session.callId) {
      const persisted = await this.voiceTranscriptService.getCallTranscript(
        session.callId,
      );
      if (
        persisted &&
        (persisted.transcriptStatus === 'final' ||
          persisted.transcriptStatus === 'processing' ||
          persisted.transcriptStatus === 'failed')
      ) {
        return { ...persisted, streamSid };
      }
    }

    const live = this.voiceTranscriptService.getLiveTranscript(streamSid);
    if (live.transcript.length > 0) {
      return live;
    }

    if (session.callId) {
      const persisted = await this.voiceTranscriptService.getCallTranscript(
        session.callId,
      );
      if (persisted) {
        return { ...persisted, streamSid };
      }
    }

    return live;
  }

  @Get('recordings')
  @ApiOperation({ summary: 'List finalized voice recordings' })
  listRecordings() {
    return {
      recordings: this.voiceRecordingService
        .listRecordings()
        .map((recording) =>
          this.voiceRecordingService.toPublicMetadata(recording),
        ),
    };
  }

  @Get('recordings/:streamSid/signed-url')
  @ApiOperation({ summary: 'Get a pre-signed S3 URL for a voice recording' })
  getSignedRecordingUrl(@Param('streamSid') streamSid: string) {
    return this.voiceRecordingService.getSignedRecordingUrl(streamSid);
  }

  @Get('recordings/:streamSid/download')
  @ApiOperation({ summary: 'Download a voice recording WAV file' })
  async downloadRecording(
    @Param('streamSid') streamSid: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const signed =
        await this.voiceRecordingService.getSignedRecordingUrl(streamSid);
      res.redirect(302, signed.url);
      return;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    const exists = await this.voiceRecordingService.recordingExists(streamSid);
    if (!exists) {
      throw new NotFoundException(`Voice recording not found: ${streamSid}`);
    }

    const stream = await this.voiceRecordingService.openRecordingReadStream(streamSid);
    if (!stream) {
      throw new NotFoundException(`Voice recording not found: ${streamSid}`);
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${streamSid}.wav"`,
    );

    stream.pipe(res);
  }

  @Get('recordings/:streamSid')
  @ApiOperation({ summary: 'Get voice recording metadata by streamSid' })
  getRecording(@Param('streamSid') streamSid: string) {
    const recording = this.voiceRecordingService.getRecording(streamSid);
    if (!recording) {
      throw new NotFoundException(`Voice recording not found: ${streamSid}`);
    }

    return this.voiceRecordingService.toPublicMetadata(recording);
  }

  @Get('health')
  @ApiOperation({ summary: 'Smartflo voice service health' })
  async health() {
    const counts = await this.voiceSessionService.getSessionCounts();
    const voiceRuntime =
      this.configService.get<VoiceRuntimeType>('VOICE_RUNTIME') ??
      VoiceRuntimeType.MOCK;
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const serverOrigin = buildServerOriginInfo({
      nodeEnv: this.configService.get<string>('NODE_ENV'),
      appVersion: this.configService.get<string>('APP_VERSION'),
      serverId: this.configService.get<string>('APP_SERVER_ID'),
      smartfloBaseUrl: this.configService.get<string>('SMARTFLO_BASE_URL'),
      voiceWssBaseUrl: this.configService.get<string>('VOICE_WSS_BASE_URL'),
    });

    return {
      success: true,
      service: 'smartflo-voice',
      activeSessions: counts.active,
      recentEndedSessions: counts.recentEnded,
      voiceRuntime,
      activeRuntimeProvider: this.voiceRuntimeFactory.getProvider().name,
      openAiKeyConfigured: Boolean(openAiKey),
      openAiRealtimeModel:
        this.configService.get<string>('OPENAI_REALTIME_MODEL') ?? null,
      voiceAudioGain: this.voiceAudioConfigService.getGain(),
      voiceAudioAutoNormalize:
        this.voiceAudioConfigService.isAutoNormalizeEnabled(),
      voiceOutboundChunkBytes:
        this.voiceAudioConfigService.getOutboundChunkBytes(),
      voiceRequireAppAuthorization:
        this.voiceCallAuthorizationService.isAuthorizationRequired(),
      voiceSharedStateUsesRedis: this.voiceSharedStateService.usesRedis,
      serverOrigin,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('smartflo/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Smartflo dynamic WebSocket URL resolver' })
  resolve() {
    const serverOrigin = buildServerOriginInfo({
      nodeEnv: this.configService.get<string>('NODE_ENV'),
      appVersion: this.configService.get<string>('APP_VERSION'),
      serverId: this.configService.get<string>('APP_SERVER_ID'),
      smartfloBaseUrl: this.configService.get<string>('SMARTFLO_BASE_URL'),
      voiceWssBaseUrl: this.configService.get<string>('VOICE_WSS_BASE_URL'),
    });

    return {
      success: true,
      wss_url: serverOrigin.voiceWssBaseUrl,
      serverOrigin,
    };
  }
}
