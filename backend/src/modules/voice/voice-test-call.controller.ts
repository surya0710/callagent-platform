import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/constants/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { VoiceTestCallDto } from './dto/voice-test-call.dto';
import { SmartfloClickToCallService } from './smartflo-click-to-call.service';

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
      'Internal-only endpoint for triggering Smartflo click-to-call during voice integration testing.',
  })
  initiateTestCall(@Body() dto: VoiceTestCallDto) {
    return this.smartfloClickToCallService.initiateTestCall(dto.customerNumber);
  }
}
