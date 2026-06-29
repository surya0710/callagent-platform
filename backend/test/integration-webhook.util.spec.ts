import {
  appendWebhookTimeParam,
  buildIntegrationWebhookAuthHeaders,
  buildRecordingDownloadUrl,
  canDeliverIntegrationWebhook,
  formatWebhookTimeParam,
  resolveIntegrationWebhookUrl,
  resolvePublicAppUrl,
} from '../src/modules/integrations/integration-webhook.util';

describe('integration-webhook.util', () => {
  describe('canDeliverIntegrationWebhook', () => {
    it('allows only integration calls with an apiKeyId', () => {
      expect(
        canDeliverIntegrationWebhook({
          source: 'integration',
          apiKeyId: 'key-1',
        }),
      ).toBe(true);
      expect(
        canDeliverIntegrationWebhook({
          source: 'integration',
          apiKeyId: null,
        }),
      ).toBe(false);
      expect(
        canDeliverIntegrationWebhook({
          source: 'test',
          apiKeyId: 'key-1',
        }),
      ).toBe(false);
    });
  });

  describe('resolveIntegrationWebhookUrl', () => {
    it('uses only the initiating API key webhook URL', () => {
      expect(
        resolveIntegrationWebhookUrl({
          webhookUrl: 'https://www.tatd.in/tatd-ai/ai-tatd-data-received-api.php',
        }),
      ).toBe('https://www.tatd.in/tatd-ai/ai-tatd-data-received-api.php');
      expect(resolveIntegrationWebhookUrl({ webhookUrl: '   ' })).toBeNull();
      expect(resolveIntegrationWebhookUrl(null)).toBeNull();
    });
  });

  describe('buildIntegrationWebhookAuthHeaders', () => {
    it('builds bearer auth from the initiating API key', () => {
      expect(
        buildIntegrationWebhookAuthHeaders({
          webhookAuthType: 'bearer',
          webhookAuthToken: 'secret',
        }),
      ).toEqual({ Authorization: 'Bearer secret' });
    });
  });

  it('formats webhook time as UTC YYYYMMDDHHmmss', () => {
    expect(
      formatWebhookTimeParam(new Date('2026-06-29T14:30:52.000Z')),
    ).toBe('20260629143052');
  });

  it('appends time query param to webhook URL', () => {
    const at = new Date('2026-06-29T14:30:52.000Z');
    expect(
      appendWebhookTimeParam(
        'https://www.tatd.in/tatd-ai/ai-tatd-data-received-api.php',
        at,
      ),
    ).toBe(
      'https://www.tatd.in/tatd-ai/ai-tatd-data-received-api.php?time=20260629143052',
    );
  });

  it('preserves existing query params when appending time', () => {
    expect(
      appendWebhookTimeParam(
        'https://example.com/hook?source=voice',
        new Date('2026-06-29T14:30:52.000Z'),
      ),
    ).toBe('https://example.com/hook?source=voice&time=20260629143052');
  });

  it('prefers FRONTEND_APP_URL for recording links', () => {
    expect(
      resolvePublicAppUrl({
        frontendAppUrl: 'https://tatdai.in/',
        voiceWssBaseUrl: 'wss://other.example/api/voice/stream',
      }),
    ).toBe('https://tatdai.in');
  });

  it('derives public app URL from VOICE_WSS_BASE_URL', () => {
    expect(
      resolvePublicAppUrl({
        voiceWssBaseUrl: 'wss://tatdai.in/api/voice/stream',
      }),
    ).toBe('https://tatdai.in');
  });

  it('returns empty recording URL when public app URL is missing', () => {
    expect(buildRecordingDownloadUrl(null, 'MZ123')).toBe('');
    expect(
      buildRecordingDownloadUrl('https://tatdai.in', 'MZ123'),
    ).toBe('https://tatdai.in/api/voice/recordings/MZ123/download');
  });
});
