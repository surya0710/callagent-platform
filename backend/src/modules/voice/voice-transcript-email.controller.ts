import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/constants/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TranscriptEmailService } from './transcript-email.service';

@ApiTags('Voice')
@Controller('voice')
export class VoiceTranscriptEmailController {
  constructor(private readonly transcriptEmailService: TranscriptEmailService) {}

  @Post('sessions/:streamSid/send-transcript-email')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_WRITE)
  @ApiOperation({ summary: 'Queue a final transcript email for a voice session' })
  sendForSession(
    @Param('streamSid') streamSid: string,
    @Body() body: { resend?: boolean } = {},
  ) {
    return this.transcriptEmailService.requestManualSend({
      streamSid,
      resend: body.resend === true,
    });
  }

  @Get('sessions/:streamSid/transcript-email-status')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get transcript email status for a voice session' })
  getSessionStatus(@Param('streamSid') streamSid: string) {
    return this.transcriptEmailService.getStatus({ streamSid });
  }
}
