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
  return call.source === 'integration' && Boolean(call.apiKeyId);
}

/** Webhook destination comes from the initiating API key, with call snapshot fallback. */
export function resolveIntegrationWebhookUrl(
  apiKey: Pick<IntegrationWebhookApiKey, 'webhookUrl'> | null | undefined,
  callWebhookSnapshot?: string | null,
): string | null {
  const url = apiKey?.webhookUrl?.trim() || callWebhookSnapshot?.trim();
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
  const time = formatWebhookTimeParam(at);

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set('time', time);
    return url.toString();
  } catch {
    const separator = webhookUrl.includes('?') ? '&' : '?';
    return `${webhookUrl}${separator}time=${time}`;
  }
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

export interface IntegrationTranscriptSegment {
  speaker: string;
  text: string;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  createdAt?: Date;
}

function integrationTranscriptSortKey(
  segment: IntegrationTranscriptSegment,
  fallbackIndex: number,
): number {
  if (typeof segment.startedAtMs === 'number') {
    return segment.startedAtMs;
  }
  if (typeof segment.endedAtMs === 'number') {
    return segment.endedAtMs;
  }
  if (segment.createdAt instanceof Date) {
    return segment.createdAt.getTime();
  }
  return fallbackIndex;
}

function formatIntegrationTranscriptSpeakerLabel(speaker: string): string {
  switch (speaker) {
    case 'customer':
      return 'Customer';
    case 'assistant':
      return 'Assistant';
    default:
      return 'Unknown';
  }
}

/** Resolve flat transcript text for partner webhooks from stored content or segments. */
export function resolveIntegrationTranscriptContent(
  transcript:
    | {
        content: string;
        segments: IntegrationTranscriptSegment[];
      }
    | null
    | undefined,
): string {
  const content = transcript?.content?.trim();
  if (content) {
    return content;
  }

  const segments = transcript?.segments ?? [];
  if (segments.length === 0) {
    return '';
  }

  return segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.text.trim().length > 0)
    .sort((left, right) => {
      const leftKey = integrationTranscriptSortKey(left.segment, left.index);
      const rightKey = integrationTranscriptSortKey(right.segment, right.index);
      if (leftKey !== rightKey) {
        return leftKey - rightKey;
      }
      return left.index - right.index;
    })
    .map(
      ({ segment }) =>
        `${formatIntegrationTranscriptSpeakerLabel(segment.speaker)}: ${segment.text.trim()}`,
    )
    .join('\n');
}
