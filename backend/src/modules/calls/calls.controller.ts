import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CallsService } from './calls.service';
import type { LiveCallAnalysis } from './calls.service';
import { CallQueryDto } from './dto/call-query.dto';
import { ProviderWebhookDto } from './dto/provider-webhook.dto';
import { TestCallDto } from './dto/test-call.dto';
import { TranscriptEmailService } from '../voice/transcript-email.service';

@ApiTags('Calls')
@Controller('calls')
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly transcriptEmailService: TranscriptEmailService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'List calls' })
  findAll(@Query() query: CallQueryDto) {
    return this.callsService.findAll(query);
  }

  @Get('analysis/live')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'List live call analyses derived from call transcripts and summaries' })
  getLiveCallAnalyses(): Promise<LiveCallAnalysis[]> {
    return this.callsService.listLiveCallAnalyses();
  }

  @Post('test')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_WRITE)
  @ApiOperation({ summary: 'Initiate a test call (placeholder)' })
  testCall(
    @Body() dto: TestCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.callsService.testCall(dto, user.id);
  }

  @Public()
  @Post('webhooks/provider')
  @ApiOperation({ summary: 'Telephony provider webhook (placeholder)' })
  providerWebhook(@Body() dto: ProviderWebhookDto) {
    return this.callsService.handleProviderWebhook(dto);
  }

  @Get(':id/events')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get call events' })
  getEvents(@Param('id') id: string) {
    return this.callsService.getEvents(id);
  }

  @Get(':id/transcript')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get call transcript' })
  getTranscript(@Param('id') id: string) {
    return this.callsService.getTranscript(id);
  }

  @Post(':id/send-transcript-email')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_WRITE)
  @ApiOperation({ summary: 'Queue a final transcript email for a call' })
  sendTranscriptEmail(
    @Param('id') id: string,
    @Body() body: { resend?: boolean } = {},
  ) {
    return this.transcriptEmailService.requestManualSend({
      callId: id,
      resend: body.resend === true,
    });
  }

  @Get(':id/transcript-email-status')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get transcript email status for a call' })
  getTranscriptEmailStatus(@Param('id') id: string) {
    return this.transcriptEmailService.getStatus({ callId: id });
  }

  @Get(':id/summary')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get call summary' })
  getSummary(@Param('id') id: string) {
    return this.callsService.getSummary(id);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get call by ID' })
  findOne(@Param('id') id: string) {
    return this.callsService.findOne(id);
  }
}
