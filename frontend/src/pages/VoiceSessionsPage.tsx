import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SessionDetailPanel } from '../components/voice/SessionDetailPanel';
import { SessionTranscriptSection } from '../components/voice/SessionTranscriptSection';
import { Button } from '../components/ui/Button';
import { Card, StatCard } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';
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
      {session.recordingAvailable && streamSid && (
        <a
          href={voiceRecordingDownloadUrl(streamSid)}
          className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          download
        >
          Download WAV
        </a>
      )}
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

  const pollInterval = autoRefresh ? POLL_INTERVAL_MS : false;

  const healthQuery = useQuery({
    queryKey: ['voice-health'],
    queryFn: voiceApi.getHealth,
    refetchInterval: pollInterval,
  });

  const sessionsQuery = useQuery({
    queryKey: ['voice-sessions'],
    queryFn: voiceApi.getSessions,
    refetchInterval: pollInterval,
  });

  const activeSessions = sessionsQuery.data?.active ?? [];
  const recentEnded = [...(sessionsQuery.data?.recentEnded ?? [])].sort(
    (a, b) =>
      new Date(b.endedAt ?? 0).getTime() - new Date(a.endedAt ?? 0).getTime(),
  );
  const hasActiveSessions = activeSessions.length > 0;

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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Voice Sessions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor Smartflo bidirectional audio streams from app-initiated calls only.
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
          value={recentEnded.length}
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
        {recentEnded.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-400">
            No recent ended sessions
          </div>
        ) : (
          <Table
            headers={[
              'Status',
              'streamSid',
              'callSid',
              'From',
              'To',
              'Packets',
              'Stop Reason',
              'Recording',
              'Started At',
              'Ended At',
              'Duration',
              'Actions',
            ]}
          >
            {recentEnded.map((session) => (
              <tr key={session.socketSessionId} className="text-slate-300">
                <td className="px-4 py-3">
                  <StatusBadge status={session.status} />
                </td>
                <td className="px-4 py-3 font-mono text-xs">{safeValue(session.streamSid)}</td>
                <td className="px-4 py-3 font-mono text-xs">{safeValue(session.callSid)}</td>
                <td className="px-4 py-3">{safeValue(session.from)}</td>
                <td className="px-4 py-3">{safeValue(session.to)}</td>
                <td className="px-4 py-3">{session.packetsReceived}</td>
                <td className="px-4 py-3">{safeValue(session.stopReason)}</td>
                <td className="px-4 py-3">
                  {session.recordingAvailable && session.streamSid ? (
                    <a
                      href={voiceRecordingDownloadUrl(session.streamSid)}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
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
          </Table>
        )}
      </Card>

      <Card title="Active Sessions">
        {activeSessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-400">
            No active Smartflo calls
          </div>
        ) : (
          <Table
            headers={[
              'Status',
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
          >
            {activeSessions.map((session) => (
              <tr key={session.socketSessionId} className="text-slate-300">
                <td className="px-4 py-3">
                  <StatusBadge status={session.status} />
                </td>
                <td className="px-4 py-3 font-mono text-xs">{safeValue(session.streamSid)}</td>
                <td className="px-4 py-3 font-mono text-xs">{safeValue(session.callSid)}</td>
                <td className="px-4 py-3">{safeValue(session.from)}</td>
                <td className="px-4 py-3">{safeValue(session.to)}</td>
                <td className="px-4 py-3 capitalize">{safeValue(session.direction)}</td>
                <td className="px-4 py-3">{session.packetsReceived}</td>
                <td className="px-4 py-3">{safeValue(session.lastEvent)}</td>
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
              </tr>
            ))}
          </Table>
        )}
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
