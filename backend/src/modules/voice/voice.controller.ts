import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  toVoiceSessionResponse,
  VoiceSessionService,
} from './voice-session.service';

const DEFAULT_WSS_BASE_URL = 'wss://tatdai.in/api/voice/stream';

@ApiTags('Voice')
@Public()
@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceSessionService: VoiceSessionService) {}

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

  @Get('health')
  @ApiOperation({ summary: 'Smartflo voice service health' })
  health() {
    const counts = this.voiceSessionService.getSessionCounts();

    return {
      success: true,
      service: 'smartflo-voice',
      activeSessions: counts.active,
      recentEndedSessions: counts.recentEnded,
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
