import {
  appendWebhookTimeParam,
  buildRecordingDownloadUrl,
  formatWebhookTimeParam,
  resolvePublicAppUrl,
} from '../src/modules/integrations/integration-webhook.util';

describe('integration-webhook.util', () => {
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
