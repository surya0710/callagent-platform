import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SessionDetailPanel } from '../components/voice/SessionDetailPanel';
import { SessionTranscriptSection } from '../components/voice/SessionTranscriptSection';
import { Button } from '../components/ui/Button';
import { Card, StatCard } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { ErrorState, LoadingState } from '../components/ui/Table';
import { ClientDataTable, DataTable } from '../components/ui/DataTable';
import { voiceApi } from '../lib/voiceApi';
import {
  copyToClipboard,
  formatDateTime,
  formatTime,
  safeValue,
  sessionDuration,
  statusBadgeClass,
} from '../lib/voice-utils';
import { VoiceSession, VoiceSessionStatus, voiceRecordingDownloadUrl } from '../types/voice';

const POLL_INTERVAL_MS = 2000;
const DEFAULT_PAGE_SIZE = 10;

function authStatusLabel(session: VoiceSession): string {
  if (session.isAppInitiated === true) {
    return 'Authorized';
  }
  if (session.isAppInitiated === false || session.rejectionReason) {
    return session.rejectionReason ?? 'Unauthorized';
  }
  if (session.authorizationId || session.authorizationSource) {
    return 'Pending';
  }
  return '—';
}

function providerLabel(session: VoiceSession): string {
  if (session.telephonyProvider) {
    return session.telephonyProvider;
  }
  if (session.runtimeProvider) {
    return session.runtimeProvider;
  }
  return 'smartflo';
}

function streamIdLabel(session: VoiceSession): string {
  const sid = session.streamSid ?? '—';
  if (session.streamSidIsFallback && session.streamSid) {
    return `${sid} (fallback)`;
  }
  return sid;
}

function aiConnectionLabel(session: VoiceSession): string {
  if (session.isOpenAiConnected || session.runtimeStatus === 'connected') {
    return 'AI connected';
  }
  if (session.runtimeStatus === 'connecting') {
    return 'AI connecting';
  }
  if (session.runtimeStatus === 'error') {
    return session.runtimeError ? `AI error` : 'AI error';
  }
  if (session.isAppInitiated === false || session.rejectionReason) {
    return session.rejectionReason === 'not_app_initiated'
      ? 'Unauthorized'
      : session.rejectionReason === 'authorization_incomplete'
        ? 'Auth incomplete'
        : 'Unauthorized';
  }
  if (session.lastEvent === 'connected' && session.status === 'PENDING') {
    return 'Stream connected';
  }
  if (session.lastEvent === 'stream_connected' && session.status === 'PENDING') {
    return 'Stream connected';
  }
  if (session.status === 'ACTIVE' && !session.runtimeStatus) {
    return 'Call active';
  }
  return 'Waiting';
}

function StatusBadge({ status }: { status: VoiceSessionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
    >
      {status === 'ACTIVE' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
      )}
      {status}
    </span>
  );
}

function SessionActions({
  session,
  onViewDetails,
  onViewTranscript,
  copiedKey,
  onCopy,
}: {
  session: VoiceSession;
  onViewDetails: (session: VoiceSession) => void;
  onViewTranscript: (session: VoiceSession) => void;
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
}) {
  const streamSid = session.streamSid ?? '';
  const copyKey = `stream-${session.socketSessionId}`;

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onViewDetails(session)}>
        View Details
      </Button>
      {streamSid && (
        <Button
          variant="secondary"
          className="px-2 py-1 text-xs"
          onClick={() => onViewTranscript(session)}
        >
          View Transcript
        </Button>
      )}
      {streamSid && (
        <Button
          variant="secondary"
          className="px-2 py-1 text-xs"
          onClick={() => onCopy(streamSid, copyKey)}
        >
          {copiedKey === copyKey ? 'Copied!' : 'Copy streamSid'}
        </Button>
      )}
      {session.recordingAvailable && streamSid ? (
        <a
          href={voiceRecordingDownloadUrl(streamSid)}
          className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          target="_blank"
          rel="noreferrer"
          download
        >
          Download WAV
        </a>
      ) : null}
    </div>
  );
}

export function VoiceSessionsPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selectedSession, setSelectedSession] = useState<VoiceSession | null>(null);
  const [transcriptSession, setTranscriptSession] = useState<VoiceSession | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [recentPage, setRecentPage] = useState(1);
  const [recentLimit, setRecentLimit] = useState(DEFAULT_PAGE_SIZE);
  const [activePage, setActivePage] = useState(1);
  const [activeLimit, setActiveLimit] = useState(DEFAULT_PAGE_SIZE);

  const pollInterval = autoRefresh ? POLL_INTERVAL_MS : false;

  const healthQuery = useQuery({
    queryKey: ['voice-health'],
    queryFn: voiceApi.getHealth,
    refetchInterval: pollInterval,
  });

  const sessionsQuery = useQuery({
    queryKey: ['voice-sessions', recentPage, recentLimit],
    queryFn: () => voiceApi.getSessions({ page: recentPage, limit: recentLimit }),
    refetchInterval: pollInterval,
  });

  const activeSessions = sessionsQuery.data?.active ?? [];
  const recentEnded = sessionsQuery.data?.recentEnded ?? [];
  const recentMeta = sessionsQuery.data?.meta ?? {
    total: 0,
    page: recentPage,
    limit: recentLimit,
    totalPages: 1,
  };
  const hasActiveSessions = activeSessions.length > 0;

  useEffect(() => {
    if (recentPage > recentMeta.totalPages && recentMeta.totalPages > 0) {
      setRecentPage(recentMeta.totalPages);
    }
  }, [recentPage, recentMeta.totalPages]);

  useEffect(() => {
    const activeTotalPages = Math.ceil(activeSessions.length / activeLimit) || 1;
    if (activePage > activeTotalPages && activeTotalPages > 0) {
      setActivePage(activeTotalPages);
    }
  }, [activePage, activeLimit, activeSessions.length]);

  useEffect(() => {
    if (!healthQuery.isFetching && !sessionsQuery.isFetching) {
      if (healthQuery.data || sessionsQuery.data) {
        setLastRefreshed(new Date());
      }
    }
  }, [healthQuery.isFetching, sessionsQuery.isFetching, healthQuery.data, sessionsQuery.data]);

  useEffect(() => {
    if (!hasActiveSessions) return undefined;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [hasActiveSessions]);

  const handleManualRefresh = useCallback(() => {
    void healthQuery.refetch();
    void sessionsQuery.refetch();
  }, [healthQuery, sessionsQuery]);

  const handleCopy = useCallback(async (value: string, key: string) => {
    try {
      await copyToClipboard(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setCopiedKey(null);
    }
  }, []);

  const initialLoading =
    (healthQuery.isLoading || sessionsQuery.isLoading) &&
    !healthQuery.data &&
    !sessionsQuery.data;

  if (initialLoading) {
    return <LoadingState />;
  }

  const healthOnline = healthQuery.isSuccess && healthQuery.data?.success;
  const healthError = healthQuery.isError;

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Voice Sessions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor live voice streams from app-initiated Smartflo and Exotel calls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600 bg-slate-950 text-indigo-500"
            />
            Auto-refresh
          </label>
          <Button variant="secondary" onClick={handleManualRefresh}>
            Refresh
          </Button>
          <Link
            to="/voice/test-call"
            className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Test Call
          </Link>
          <span className="text-xs text-slate-500">
            Last refresh: {lastRefreshed ? formatTime(lastRefreshed) : '—'}
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Service Status"
          value={
            healthError
              ? 'Offline'
              : healthOnline
                ? 'Online'
                : 'Unknown'
          }
          sub={
            healthError
              ? 'Health check failed'
              : healthQuery.data?.serverOrigin
                ? `${healthQuery.data.serverOrigin.serverId ?? healthQuery.data.serverOrigin.hostname} · WSS ${healthQuery.data.serverOrigin.voiceWssBaseUrl}`
                : healthQuery.data
                  ? `Smartflo Voice: ${healthQuery.data.service}`
                  : undefined
          }
        />
        <StatCard
          label="Active Sessions"
          value={activeSessions.length}
        />
        <StatCard
          label="Recent Ended"
          value={recentMeta.total}
        />
        <StatCard
          label="Server Time"
          value={
            healthQuery.data?.timestamp
              ? formatTime(new Date(healthQuery.data.timestamp))
              : '—'
          }
          sub={healthQuery.data?.timestamp ? formatDateTime(healthQuery.data.timestamp) : undefined}
        />
      </div>

      {hasActiveSessions && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          Live call in progress. After you hang up, wait for the session to show{' '}
          <span className="font-medium text-amber-50">ENDED</span>, then use{' '}
          <span className="font-medium text-amber-50">View Transcript</span> or download the WAV.
        </div>
      )}

      {healthQuery.data?.serverOrigin && (
        <Card title="Call server origin">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">API server hostname</dt>
              <dd className="mt-0.5 text-slate-200">
                {healthQuery.data.serverOrigin.serverId ??
                  healthQuery.data.serverOrigin.hostname}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Environment</dt>
              <dd className="mt-0.5 text-slate-200">
                {healthQuery.data.serverOrigin.environment ?? '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Smartflo API target</dt>
              <dd className="mt-0.5 break-all text-slate-200">
                {healthQuery.data.serverOrigin.smartfloApiBaseUrl}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Voice stream (Smartflo connects here)</dt>
              <dd className="mt-0.5 break-all text-slate-200">
                {healthQuery.data.serverOrigin.voiceWssBaseUrl}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Initiate Call hits this API server, which posts to Smartflo. Smartflo then opens audio
            on the WSS URL above — it may differ from the API hostname if{' '}
            <code className="text-slate-400">VOICE_WSS_BASE_URL</code> points elsewhere.
          </p>
        </Card>
      )}

      {healthError && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-4 text-amber-200">
          Unable to reach voice health endpoint. Service may be offline.
        </div>
      )}

      {sessionsQuery.isError && (
        <ErrorState message="Failed to load voice sessions. Showing last successful data if available." />
      )}

      <Card title="Recent Ended Sessions">
        <DataTable
          headers={[
            'Status',
            'Provider',
            'Auth',
            'streamSid',
            'callSid',
            'From',
            'To',
            'Packets',
            'Stop / Rejection',
            'Recording',
            'Started At',
            'Ended At',
            'Duration',
            'Actions',
          ]}
          empty={recentMeta.total === 0}
          emptyMessage="No recent ended sessions"
          meta={recentMeta}
          onPageChange={setRecentPage}
          onLimitChange={(limit) => {
            setRecentLimit(limit);
            setRecentPage(1);
          }}
        >
          {recentEnded.map((session) => (
            <tr key={session.socketSessionId} className="text-slate-300">
              <td className="px-4 py-3">
                <StatusBadge status={session.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 capitalize">
                {providerLabel(session)}
              </td>
              <td className="max-w-[10rem] truncate px-4 py-3 text-xs" title={authStatusLabel(session)}>
                {authStatusLabel(session)}
              </td>
              <td
                className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs"
                title={session.streamSid ?? undefined}
              >
                {streamIdLabel(session)}
              </td>
              <td
                className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs"
                title={session.callSid ?? undefined}
              >
                {safeValue(session.callSid)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">{safeValue(session.from)}</td>
              <td className="whitespace-nowrap px-4 py-3">{safeValue(session.to)}</td>
              <td className="whitespace-nowrap px-4 py-3">{session.packetsReceived}</td>
              <td className="max-w-[12rem] truncate px-4 py-3" title={session.stopReason ?? session.rejectionReason ?? undefined}>
                {safeValue(session.stopReason ?? session.rejectionReason)}
              </td>
              <td className="px-4 py-3">
                {session.recordingAvailable && session.streamSid ? (
                  <a
                    href={voiceRecordingDownloadUrl(session.streamSid)}
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    Download WAV
                  </a>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
              <td className="px-4 py-3">{formatDateTime(session.startedAt ?? session.connectedAt)}</td>
              <td className="px-4 py-3">{formatDateTime(session.endedAt ?? undefined)}</td>
              <td className="px-4 py-3">{sessionDuration(session)}</td>
              <td className="px-4 py-3">
                <SessionActions
                  session={session}
                  onViewDetails={setSelectedSession}
                  onViewTranscript={setTranscriptSession}
                  copiedKey={copiedKey}
                  onCopy={handleCopy}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Active Sessions">
        <ClientDataTable
          headers={[
            'Status',
            'Provider',
            'AI',
            'Auth',
            'streamSid',
            'callSid',
            'From',
            'To',
            'Direction',
            'Packets',
            'Last Event',
            'Last Event At',
            'Duration',
            'Actions',
          ]}
          data={activeSessions}
          page={activePage}
          limit={activeLimit}
          onPageChange={setActivePage}
          onLimitChange={(limit) => {
            setActiveLimit(limit);
            setActivePage(1);
          }}
          emptyMessage="No active voice calls"
          rowKey={(session) => session.socketSessionId}
          renderRow={(session) => (
            <>
              <td className="px-4 py-3">
                <StatusBadge status={session.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 capitalize">
                {providerLabel(session)}
              </td>
              <td className="px-4 py-3 text-xs capitalize">{aiConnectionLabel(session)}</td>
              <td className="max-w-[10rem] truncate px-4 py-3 text-xs" title={authStatusLabel(session)}>
                {authStatusLabel(session)}
              </td>
              <td
                className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs"
                title={session.streamSid ?? undefined}
              >
                {streamIdLabel(session)}
              </td>
              <td
                className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs"
                title={session.callSid ?? undefined}
              >
                {safeValue(session.callSid)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">{safeValue(session.from)}</td>
              <td className="whitespace-nowrap px-4 py-3">{safeValue(session.to)}</td>
              <td className="whitespace-nowrap px-4 py-3 capitalize">{safeValue(session.direction)}</td>
              <td className="whitespace-nowrap px-4 py-3">{session.packetsReceived}</td>
              <td className="max-w-[12rem] truncate px-4 py-3" title={session.lastEvent ?? undefined}>
                {safeValue(session.lastEvent)}
              </td>
              <td className="px-4 py-3">{formatDateTime(session.lastEventAt)}</td>
              <td className="px-4 py-3">{sessionDuration(session, now)}</td>
              <td className="px-4 py-3">
                <SessionActions
                  session={session}
                  onViewDetails={setSelectedSession}
                  onViewTranscript={setTranscriptSession}
                  copiedKey={copiedKey}
                  onCopy={handleCopy}
                />
              </td>
            </>
          )}
        />
      </Card>

      {selectedSession && (
        <SessionDetailPanel
          session={selectedSession}
          now={now}
          onClose={() => setSelectedSession(null)}
        />
      )}

      <Modal
        title="Call Transcript"
        open={Boolean(transcriptSession?.streamSid)}
        onClose={() => setTranscriptSession(null)}
        wide
      >
        {transcriptSession?.streamSid && (
          <SessionTranscriptSection
            streamSid={transcriptSession.streamSid}
            callId={transcriptSession.callId}
          />
        )}
      </Modal>
    </div>
  );
}
