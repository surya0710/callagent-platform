import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PERMISSIONS } from '../../common/constants/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { VoiceTestCallDto } from './dto/voice-test-call.dto';
import { SmartfloClickToCallService } from './smartflo-click-to-call.service';

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
    private readonly smartfloClickToCallService: SmartfloClickToCallService,
  ) {}

  @Post('test-call')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CALLS_WRITE)
  @ApiOperation({
    summary: 'Initiate Smartflo click-to-call test (internal)',
    description:
      'Internal-only endpoint for triggering Smartflo click-to-call during voice integration testing. Optionally pass callContext with booking/customer details for AI runtime injection.',
  })
  initiateTestCall(@Body() dto: VoiceTestCallDto, @Req() request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    return this.smartfloClickToCallService.initiateTestCall(dto.customerNumber, {
      requestedByIp: resolveRequestIp(request),
      requestedByForwardedFor:
        typeof forwardedFor === 'string' ? forwardedFor : undefined,
      callContext: dto.callContext,
    });
  }
}
