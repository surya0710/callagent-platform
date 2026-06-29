import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { normalizeIntegrationCallRequest } from './integration-call-request.util';

@Injectable()
export class NormalizeIntegrationCallInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ body?: unknown }>();

    if (request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
      request.body = normalizeIntegrationCallRequest(
        request.body as Record<string, unknown>,
      );
    }

    return next.handle();
  }
}
