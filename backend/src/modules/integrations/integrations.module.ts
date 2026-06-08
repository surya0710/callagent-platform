import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { OnDemandCallProcessor } from '../../queues/processors/on-demand-call.processor';
import { AgentPromptsModule } from '../agent-prompts/agent-prompts.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { IntegrationCallbackService } from './integration-callback.service';
import { IntegrationCallsService } from './integration-calls.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [AgentPromptsModule],
  controllers: [IntegrationsController, ApiKeysController],
  providers: [
    ApiKeysService,
    IntegrationCallsService,
    IntegrationCallbackService,
    OnDemandCallProcessor,
    ApiKeyGuard,
  ],
  exports: [
    ApiKeysService,
    IntegrationCallbackService,
    IntegrationCallsService,
    OnDemandCallProcessor,
  ],
})
export class IntegrationsModule {}
