import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
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
import {
  toVoiceSessionResponse,
  VoiceSessionService,
} from './voice-session.service';

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
  ) {}

  @Get('sessions')
  @ApiOperation({ summary: 'List active and recently ended voice sessions' })
  listSessions() {
    return {
      active: this.voiceSessionService
        .getActiveSessions()
        .map(toVoiceSessionResponse),
      recentEnded: this.voiceSessionService
        .getRecentEndedSessions()
        .map(toVoiceSessionResponse),
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
  listRecentSessions() {
    return this.voiceSessionService
      .getRecentEndedSessions()
      .map(toVoiceSessionResponse);
  }

  @Get('sessions/:streamSid/runtime-debug')
  @ApiOperation({ summary: 'Runtime debug snapshot for a voice session' })
  getRuntimeDebug(@Param('streamSid') streamSid: string) {
    const session = this.voiceSessionService.getByStreamSid(streamSid);
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
      isOpenAiConnected: response.isOpenAiConnected ?? false,
      hasReceivedCallerAudio: response.hasReceivedCallerAudio ?? false,
      lastCallerAudioAt: response.lastCallerAudioAt ?? null,
      lastOpenAiAppendAt: response.lastOpenAiAppendAt ?? null,
      lastSpeechStartedAt: response.lastSpeechStartedAt ?? null,
      lastSpeechStoppedAt: response.lastSpeechStoppedAt ?? null,
      lastCommitAt: response.lastCommitAt ?? null,
      lastResponseCreateAt: response.lastResponseCreateAt ?? null,
      lastResponseDoneAt: response.lastResponseDoneAt ?? null,
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
      timestamp: new Date().toISOString(),
    };
  }

  @Get('sessions/:streamSid')
  @ApiOperation({ summary: 'Get a voice session by streamSid' })
  getSessionByStreamSid(@Param('streamSid') streamSid: string) {
    const session = this.voiceSessionService.getByStreamSid(streamSid);
    if (!session) {
      throw new NotFoundException(`Voice session not found: ${streamSid}`);
    }

    return toVoiceSessionResponse(session);
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

  @Get('recordings/:streamSid/download')
  @ApiOperation({ summary: 'Download a voice recording WAV file' })
  async downloadRecording(
    @Param('streamSid') streamSid: string,
    @Res() res: Response,
  ): Promise<void> {
    const recording = this.voiceRecordingService.getRecording(streamSid);
    if (!recording) {
      throw new NotFoundException(`Voice recording not found: ${streamSid}`);
    }

    const exists = await this.voiceRecordingService.recordingExists(streamSid);
    if (!exists) {
      throw new NotFoundException(
        `Voice recording file missing: ${streamSid}`,
      );
    }

    const stream = this.voiceRecordingService.openRecordingReadStream(streamSid);
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
  health() {
    const counts = this.voiceSessionService.getSessionCounts();
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
