import type { ErrorEvent } from '@sentry/nestjs';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'cookie',
  'jwt',
  'refreshtoken',
]);

export function isSentryEnabled(): boolean {
  return (
    process.env.SENTRY_ENABLED === 'true' &&
    Boolean(process.env.SENTRY_DSN?.trim())
  );
}

export function isSentryTestAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.SENTRY_TEST_ENABLED === 'true'
  );
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

export function sanitizeSensitiveValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveValue(item)) as T;
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      sanitized[key] = isSensitiveKey(key)
        ? '[Filtered]'
        : sanitizeSensitiveValue(nestedValue);
    }

    return sanitized as T;
  }

  return value;
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.headers) {
    event.request.headers = sanitizeSensitiveValue(event.request.headers);
  }

  if (event.request?.data) {
    event.request.data = sanitizeSensitiveValue(event.request.data);
  }

  if (event.request?.cookies) {
    event.request.cookies = Object.fromEntries(
      Object.keys(event.request.cookies).map((key) => [key, '[Filtered]']),
    );
  }

  if (event.extra) {
    event.extra = sanitizeSensitiveValue(event.extra);
  }

  if (event.contexts) {
    event.contexts = sanitizeSensitiveValue(event.contexts);
  }

  return event;
}
