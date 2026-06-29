import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { Public } from '../../common/decorators/public.decorator';
import { IntegrationApiKey } from '../../common/decorators/integration-api-key.decorator';
import { IntegrationApiKeyContext } from './interfaces/integration-context.interface';
import { IntegrationCallsService } from './integration-calls.service';
import { OnDemandCallDto } from './dto/on-demand-call.dto';

@ApiTags('Integrations')
@ApiSecurity('api-key')
@ApiHeader({
  name: 'X-API-Key',
  description: 'Integration API key (format: avp_...)',
  required: true,
})
@Public()
@UseGuards(ApiKeyGuard)
@Controller('integrations/v1')
export class IntegrationsController {
  constructor(private readonly integrationCallsService: IntegrationCallsService) {}

  @Post('calls')
  @ApiOperation({
    summary: 'Initiate an outbound AI voice call (Smartflo click-to-call)',
    description:
      'Same payload shape as POST /voice/test-call, plus externalRef for idempotency. ' +
      'Webhooks are delivered only to the webhookUrl configured on the initiating API key. ' +
      'Places a Smartflo outbound call and injects callContext into the AI voice runtime.',
  })
  createOnDemandCall(
    @Body() dto: OnDemandCallDto,
    @IntegrationApiKey() apiKey: IntegrationApiKeyContext,
  ) {
    return this.integrationCallsService.createOnDemandCall(dto, apiKey);
  }

  @Get('calls/ref/:externalRef')
  @ApiOperation({ summary: 'Get call status by your external reference (trip/booking ID)' })
  getByExternalRef(
    @Param('externalRef') externalRef: string,
    @IntegrationApiKey() apiKey: IntegrationApiKeyContext,
  ) {
    return this.integrationCallsService.getByExternalRef(externalRef, apiKey);
  }

  @Get('calls/:id')
  @ApiOperation({ summary: 'Get call status by internal call ID' })
  getById(
    @Param('id') id: string,
    @IntegrationApiKey() apiKey: IntegrationApiKeyContext,
  ) {
    return this.integrationCallsService.getById(id, apiKey);
  }
}
