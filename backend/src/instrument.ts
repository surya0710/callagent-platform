import * as Sentry from '@sentry/nestjs';
import {
  isSentryEnabled,
  sanitizeSensitiveValue,
  sanitizeSentryEvent,
} from './common/sentry/sentry.util';

if (isSentryEnabled()) {
  const tracesSampleRate = Number.parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
  );

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.APP_VERSION,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = sanitizeSensitiveValue(breadcrumb.data);
      }

      return breadcrumb;
    },
  });
}
