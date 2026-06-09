import { config } from 'dotenv';
import { resolve } from 'path';
import * as Sentry from '@sentry/nestjs';

config({ path: resolve(__dirname, '../.env') });

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  enabled: process.env.SENTRY_ENABLED === 'true' && !!process.env.SENTRY_DSN,
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
    return event;
  },
});
