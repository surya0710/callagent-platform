import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PERMISSIONS } from '../../common/constants/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { VoiceTestCallDto } from './dto/voice-test-call.dto';
import { TelephonyOutboundCallService } from './telephony/telephony-outbound-call.service';

function resolveRequestIp(request: Request): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  return request.ip;
}

@ApiTags('Voice')
@ApiBearerAuth()
@Controller('voice')
export class VoiceTestCallController {
  constructor(
    private readonly telephonyOutboundCallService: TelephonyOutboundCallService,
  ) {}

  @Post('test-call')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CALLS_WRITE)
  @ApiOperation({
    summary: 'Initiate telephony test call (Smartflo or Exotel via TELEPHONY_PROVIDER)',
    description:
      'Internal-only endpoint for triggering outbound voice test calls. Provider is selected by TELEPHONY_PROVIDER env. Optionally pass callContext with booking/customer details for AI runtime injection.',
  })
  initiateTestCall(@Body() dto: VoiceTestCallDto, @Req() request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    return this.telephonyOutboundCallService.initiateTestCall(dto.customerNumber, {
      requestedByIp: resolveRequestIp(request),
      requestedByForwardedFor:
        typeof forwardedFor === 'string' ? forwardedFor : undefined,
      callContext: dto.callContext,
    });
  }
}
