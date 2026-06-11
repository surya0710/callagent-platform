import { VoiceSessionStatus } from '../types/voice';

export function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function formatTime(value?: Date): string {
  if (!value || Number.isNaN(value.getTime())) return '—';
  return value.toLocaleTimeString();
}

function parseTimestamp(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function formatDuration(
  start?: string,
  end?: string | null,
  now?: Date,
): string {
  const startMs = parseTimestamp(start);
  if (startMs === null) return '—';

  let endMs: number;
  if (end) {
    const parsed = parseTimestamp(end);
    endMs = parsed ?? Date.now();
  } else {
    endMs = now?.getTime() ?? Date.now();
  }

  const diffSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function sessionDuration(
  session: { status: VoiceSessionStatus; connectedAt?: string; startedAt?: string; endedAt?: string | null },
  now?: Date,
): string {
  const start = session.startedAt ?? session.connectedAt;
  if (session.status === 'ENDED') {
    return formatDuration(start, session.endedAt);
  }
  return formatDuration(start, null, now);
}

export async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function statusBadgeClass(status: VoiceSessionStatus): string {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'ACTIVE':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'ENDED':
      return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  }
}

export function safeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}
