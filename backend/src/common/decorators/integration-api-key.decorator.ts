import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { IntegrationApiKeyContext } from '../../modules/integrations/interfaces/integration-context.interface';

export const IntegrationApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IntegrationApiKeyContext => {
    const request = ctx.switchToHttp().getRequest<{
      integrationApiKey: IntegrationApiKeyContext;
    }>();
    return request.integrationApiKey;
  },
);
