import { ReactNode } from 'react';
import { VoiceSession, voiceRecordingDownloadUrl } from '../../types/voice';
import {
  formatDateTime,
  safeValue,
  sessionDuration,
  statusBadgeClass,
} from '../../lib/voice-utils';

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

function BadgeList({ items }: { items?: string[] }) {
  if (!items?.length) {
    return <span className="text-slate-500">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

export function SessionDetailPanel({
  session,
  now,
  onClose,
}: {
  session: VoiceSession;
  now: Date;
  onClose: () => void;
}) {
  const customParams =
    session.customParameters && Object.keys(session.customParameters).length > 0
      ? JSON.stringify(session.customParameters, null, 2)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close session details"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Session Details</h3>
            <p className="text-xs text-slate-500">{safeValue(session.streamSid)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <Section title="Identity">
            <DetailRow label="Socket Session ID" value={safeValue(session.socketSessionId)} />
            <DetailRow label="Stream SID" value={safeValue(session.streamSid)} />
            <DetailRow label="Call SID" value={safeValue(session.callSid)} />
            <DetailRow label="Account SID" value={safeValue(session.accountSid)} />
          </Section>

          <Section title="Caller">
            <DetailRow label="From" value={safeValue(session.from)} />
            <DetailRow label="To" value={safeValue(session.to)} />
            <DetailRow label="Direction" value={safeValue(session.direction)} />
            <DetailRow label="Remote Address" value={safeValue(session.remoteAddress)} />
          </Section>

          <Section title="Lifecycle">
            <DetailRow
              label="Status"
              value={
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(session.status)}`}
                >
                  {session.status === 'ACTIVE' && (
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  )}
                  {session.status}
                </span>
              }
            />
            <DetailRow label="Connected At" value={formatDateTime(session.connectedAt)} />
            <DetailRow label="Started At" value={formatDateTime(session.startedAt)} />
            <DetailRow label="Ended At" value={formatDateTime(session.endedAt ?? undefined)} />
            <DetailRow label="Duration" value={sessionDuration(session, now)} />
            <DetailRow label="Stop Reason" value={safeValue(session.stopReason)} />
          </Section>

          <Section title="Activity">
            <DetailRow label="Last Event" value={safeValue(session.lastEvent)} />
            <DetailRow label="Last Event At" value={formatDateTime(session.lastEventAt)} />
            <DetailRow label="Packets Received" value={safeValue(session.packetsReceived)} />
            <DetailRow label="Last Media Chunk" value={safeValue(session.lastMediaChunk)} />
            <DetailRow label="Last Media Timestamp" value={safeValue(session.lastMediaTimestamp)} />
            <DetailRow
              label="Last Media Payload Length"
              value={safeValue(session.lastMediaPayloadLength)}
            />
          </Section>

          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              DTMF
            </h4>
            <BadgeList items={session.dtmfDigits} />
          </section>

          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Marks
            </h4>
            <BadgeList items={session.marksReceived} />
          </section>

          <Section title="Media Format">
            <DetailRow label="Encoding" value={safeValue(session.mediaFormat?.encoding)} />
            <DetailRow label="Sample Rate" value={safeValue(session.mediaFormat?.sampleRate)} />
            <DetailRow label="Bit Rate" value={safeValue(session.mediaFormat?.bitRate)} />
            <DetailRow label="Bit Depth" value={safeValue(session.mediaFormat?.bitDepth)} />
          </Section>

          <Section title="Recording">
            <DetailRow
              label="Available"
              value={session.recordingAvailable ? 'Yes' : 'No'}
            />
            <DetailRow
              label="File Name"
              value={safeValue(session.recordingFileName)}
            />
            <DetailRow
              label="Duration (est.)"
              value={
                session.recordingDurationMsEstimate != null
                  ? `${session.recordingDurationMsEstimate} ms`
                  : '—'
              }
            />
            <DetailRow
              label="μ-law Bytes"
              value={safeValue(session.recordingMulawBytes)}
            />
            <DetailRow
              label="WAV Bytes"
              value={safeValue(session.recordingWavBytes)}
            />
            {session.recordingAvailable && session.streamSid && (
              <div className="sm:col-span-2">
                <a
                  href={voiceRecordingDownloadUrl(session.streamSid)}
                  className="inline-flex items-center rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-500/20"
                  download
                >
                  Download WAV
                </a>
              </div>
            )}
          </Section>

          {customParams && (
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Custom Parameters
              </h4>
              <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                {customParams}
              </pre>
            </section>
          )}

          <details className="rounded-lg border border-slate-800 bg-slate-950/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300 hover:text-white">
              Session JSON
            </summary>
            <pre className="max-h-64 overflow-auto border-t border-slate-800 p-4 text-xs text-slate-400">
              {JSON.stringify(session, null, 2)}
            </pre>
          </details>
        </div>
      </aside>
    </div>
  );
}
