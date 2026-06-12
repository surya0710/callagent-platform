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
import { ConfigService } from '@nestjs/config';
import { VoiceRuntimeType } from '../../config/env.validation';
import { VoiceRecordingService } from './audio/voice-recording.service';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import {
  toVoiceSessionResponse,
  VoiceSessionService,
} from './voice-session.service';

const DEFAULT_WSS_BASE_URL = 'wss://tatdai.in/api/voice/stream';

@ApiTags('Voice')
@Public()
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceSessionService: VoiceSessionService,
    private readonly voiceRecordingService: VoiceRecordingService,
    private readonly configService: ConfigService,
    private readonly voiceRuntimeFactory: VoiceRuntimeFactory,
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
      timestamp: new Date().toISOString(),
    };
  }

  @Post('smartflo/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Smartflo dynamic WebSocket URL resolver' })
  resolve() {
    const wssUrl =
      process.env.VOICE_WSS_BASE_URL?.trim() || DEFAULT_WSS_BASE_URL;

    return {
      success: true,
      wss_url: wssUrl,
    };
  }
}
