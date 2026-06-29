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
