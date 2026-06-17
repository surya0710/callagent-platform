import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { voiceApi } from '../../lib/voiceApi';
import { safeValue } from '../../lib/voice-utils';
import { VoiceTranscriptResponse } from '../../types/voice';
import { LoadingState } from '../ui/Table';

function speakerLabel(speaker: string): string {
  if (speaker === 'customer') return 'Customer';
  if (speaker === 'assistant') return 'Assistant';
  return 'Unknown';
}

function statusClass(status: VoiceTranscriptResponse['transcriptStatus']): string {
  switch (status) {
    case 'final':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'processing':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'draft':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-300';
    default:
      return 'border-slate-600 bg-slate-800 text-slate-400';
  }
}

export function SessionTranscriptSection({
  streamSid,
  callId,
}: {
  streamSid: string;
  callId?: string;
}) {
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['voice-session-transcript', streamSid],
    queryFn: () => voiceApi.getSessionTranscript(streamSid),
    enabled: Boolean(streamSid),
    refetchInterval: (query) => {
      const status = query.state.data?.transcriptStatus;
      return status === 'processing' || status === 'draft' ? 3000 : false;
    },
  });

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <p className="text-sm text-red-300">
        Failed to load transcript. Try again after the call ends.
      </p>
    );
  }

  const segments = data?.transcript ?? [];
  const hasContent = segments.length > 0 || Boolean(data?.content);
  const resolvedCallId = data?.callId ?? callId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(data?.transcriptStatus ?? 'none')}`}
        >
          {data?.transcriptStatus ?? 'none'}
          {isFetching && data?.transcriptStatus !== 'final' ? ' · updating…' : ''}
        </span>
        {data?.transcriptMode && (
          <span className="text-xs text-slate-500">Mode: {data.transcriptMode}</span>
        )}
        {data?.transcriptLanguageDetected && (
          <span className="text-xs text-slate-500">
            Language: {data.transcriptLanguageDetected}
          </span>
        )}
        {typeof data?.realtimeTranscriptCount === 'number' && data.realtimeTranscriptCount > 0 && (
          <span className="text-xs text-slate-500">
            Draft segments: {data.realtimeTranscriptCount}
          </span>
        )}
      </div>

      {data?.transcriptError && (
        <p className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          {data.transcriptError}
        </p>
      )}

      {!hasContent && (
        <p className="text-sm text-slate-400">
          No transcript yet. For ended calls, wait a few seconds for post-call processing.
          Ensure <code className="text-slate-300">VOICE_TRANSCRIPT_ENABLED=true</code> and the
          worker is running.
        </p>
      )}

      {segments.length > 0 ? (
        <div className="max-h-96 space-y-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          {segments.map((segment, index) => (
            <div key={`${segment.source}-${index}`}>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {speakerLabel(segment.speaker)}
                {segment.status === 'draft' ? ' · draft' : ''}
                {segment.source === 'postcall' ? ' · final' : ''}
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-200">{segment.text}</p>
            </div>
          ))}
        </div>
      ) : (
        data?.content && (
          <p className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-200">
            {data.content}
          </p>
        )
      )}

      {resolvedCallId && (
        <Link
          to={`/calls/${resolvedCallId}`}
          className="inline-flex text-sm text-indigo-400 hover:text-indigo-300"
        >
          Open full call record →
        </Link>
      )}

      <p className="text-xs text-slate-500">Stream SID: {safeValue(streamSid)}</p>
    </div>
  );
}
