import { Module, forwardRef } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { VoiceModule } from '../voice/voice.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { IntegrationCallbackService } from './integration-callback.service';
import { IntegrationCallsService } from './integration-calls.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [forwardRef(() => VoiceModule)],
  controllers: [IntegrationsController, ApiKeysController],
  providers: [
    ApiKeysService,
    IntegrationCallsService,
    IntegrationCallbackService,
    ApiKeyGuard,
  ],
  exports: [
    ApiKeysService,
    IntegrationCallbackService,
    IntegrationCallsService,
  ],
})
export class IntegrationsModule {}
