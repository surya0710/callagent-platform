import type { ErrorEvent } from '@sentry/nestjs';
import {
  isSentryEnabled,
  isSentryTestAllowed,
  sanitizeSensitiveValue,
  sanitizeSentryEvent,
} from '../src/common/sentry/sentry.util';

describe('Sentry utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isSentryEnabled', () => {
    it('returns true only when enabled and DSN is set', () => {
      process.env.SENTRY_ENABLED = 'true';
      process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';

      expect(isSentryEnabled()).toBe(true);
    });

    it('returns false when disabled', () => {
      process.env.SENTRY_ENABLED = 'false';
      process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';

      expect(isSentryEnabled()).toBe(false);
    });

    it('returns false when DSN is missing', () => {
      process.env.SENTRY_ENABLED = 'true';
      delete process.env.SENTRY_DSN;

      expect(isSentryEnabled()).toBe(false);
    });
  });

  describe('isSentryTestAllowed', () => {
    it('allows test outside production', () => {
      process.env.NODE_ENV = 'development';
      process.env.SENTRY_TEST_ENABLED = 'false';

      expect(isSentryTestAllowed()).toBe(true);
    });

    it('allows test in production when explicitly enabled', () => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_TEST_ENABLED = 'true';

      expect(isSentryTestAllowed()).toBe(true);
    });

    it('blocks test in production by default', () => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_TEST_ENABLED = 'false';

      expect(isSentryTestAllowed()).toBe(false);
    });
  });

  describe('sanitizeSensitiveValue', () => {
    it('redacts sensitive keys recursively', () => {
      const input = {
        username: 'demo',
        password: 'secret',
        headers: {
          Authorization: 'Bearer token',
          cookie: 'session=abc',
        },
        body: {
          refreshToken: 'refresh',
          jwt: 'jwt-value',
          token: 'access',
        },
      };

      expect(sanitizeSensitiveValue(input)).toEqual({
        username: 'demo',
        password: '[Filtered]',
        headers: {
          Authorization: '[Filtered]',
          cookie: '[Filtered]',
        },
        body: {
          refreshToken: '[Filtered]',
          jwt: '[Filtered]',
          token: '[Filtered]',
        },
      });
    });
  });

  describe('sanitizeSentryEvent', () => {
    it('sanitizes request and extra fields', () => {
      const event = sanitizeSentryEvent({
        type: undefined,
        request: {
          headers: { authorization: 'Bearer secret' },
          data: { password: 'secret' },
          cookies: { session: 'abc' },
        },
        extra: { token: 'value' },
        contexts: { custom: { jwt: 'value' } },
      } as ErrorEvent);

      expect(event.request?.headers).toEqual({ authorization: '[Filtered]' });
      expect(event.request?.data).toEqual({ password: '[Filtered]' });
      expect(event.request?.cookies).toEqual({ session: '[Filtered]' });
      expect(event.extra).toEqual({ token: '[Filtered]' });
      expect(event.contexts).toEqual({ custom: { jwt: '[Filtered]' } });
    });
  });
});
