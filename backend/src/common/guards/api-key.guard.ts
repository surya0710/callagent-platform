import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from '../../modules/integrations/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      integrationApiKey?: { id: string; name: string };
    }>();

    const headerKey =
      request.headers['x-api-key'] ??
      this.extractBearerKey(request.headers.authorization);

    if (!headerKey) {
      throw new UnauthorizedException('Missing API key. Use X-API-Key header.');
    }

    const apiKey = await this.apiKeysService.validateKey(headerKey);
    request.integrationApiKey = { id: apiKey.id, name: apiKey.name };
    return true;
  }

  private extractBearerKey(authHeader?: string): string | undefined {
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    const token = authHeader.slice(7);
    return token.startsWith('avp_') ? token : undefined;
  }
}
