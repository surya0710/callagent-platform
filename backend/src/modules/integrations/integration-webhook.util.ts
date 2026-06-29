export interface IntegrationWebhookApiKey {
  webhookUrl?: string | null;
  webhookAuthType?: 'none' | 'bearer' | 'header' | null;
  webhookAuthHeaderName?: string | null;
  webhookAuthToken?: string | null;
}

export function canDeliverIntegrationWebhook(call: {
  source: string;
  apiKeyId?: string | null;
}): boolean {
  return call.source === 'integration' && Boolean(call.apiKeyId?.trim());
}

/** Webhook destination comes only from the initiating API key record. */
export function resolveIntegrationWebhookUrl(
  apiKey: Pick<IntegrationWebhookApiKey, 'webhookUrl'> | null | undefined,
): string | null {
  const url = apiKey?.webhookUrl?.trim();
  return url || null;
}

export function buildIntegrationWebhookAuthHeaders(
  apiKey: IntegrationWebhookApiKey | null | undefined,
): Record<string, string> {
  if (!apiKey?.webhookAuthToken?.trim()) {
    return {};
  }

  const token = apiKey.webhookAuthToken.trim();

  switch (apiKey.webhookAuthType) {
    case 'bearer':
      return { Authorization: `Bearer ${token}` };
    case 'header': {
      const headerName = apiKey.webhookAuthHeaderName?.trim() || 'X-API-Key';
      return { [headerName]: token };
    }
    default:
      return {};
  }
}

/** Append a UTC timestamp query param before POSTing to a partner webhook URL. */
export function appendWebhookTimeParam(
  webhookUrl: string,
  at: Date = new Date(),
): string {
  const url = new URL(webhookUrl);
  url.searchParams.set('time', formatWebhookTimeParam(at));
  return url.toString();
}

export function formatWebhookTimeParam(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    `${at.getUTCFullYear()}` +
    `${pad(at.getUTCMonth() + 1)}` +
    `${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}` +
    `${pad(at.getUTCMinutes())}` +
    `${pad(at.getUTCSeconds())}`
  );
}

export function resolvePublicAppUrl(config: {
  frontendAppUrl?: string;
  voiceWssBaseUrl?: string;
}): string | null {
  const frontend = config.frontendAppUrl?.trim();
  if (frontend) {
    return frontend.replace(/\/+$/, '');
  }

  const wssBase = config.voiceWssBaseUrl?.trim();
  if (!wssBase) {
    return null;
  }

  try {
    const parsed = new URL(wssBase);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildRecordingDownloadUrl(
  publicAppUrl: string | null,
  streamSid: string,
): string {
  if (!publicAppUrl) {
    return '';
  }

  return `${publicAppUrl}/api/voice/recordings/${encodeURIComponent(streamSid)}/download`;
}
