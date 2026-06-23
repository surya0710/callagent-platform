import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { TranscriptEmailStatus, TranscriptEmailStatusResponse } from '../types/voice';

interface TranscriptSegment {
  speaker: 'customer' | 'assistant' | 'unknown';
  text: string;
  startedAtMs?: number;
  endedAtMs?: number;
  source: 'realtime' | 'postcall';
  status: 'draft' | 'final';
  language?: string;
}

interface TranscriptResponse {
  transcriptStatus: 'none' | 'draft' | 'processing' | 'final' | 'failed';
  transcriptMode?: string;
  transcriptLanguageDetected?: string;
  transcriptError?: string;
  realtimeTranscriptCount?: number;
  content?: string;
  transcript?: TranscriptSegment[];
}

function speakerLabel(speaker: TranscriptSegment['speaker']): string {
  if (speaker === 'customer') return 'Customer';
  if (speaker === 'assistant') return 'Assistant';
  return 'Unknown';
}

function emailStatusLabel(status: TranscriptEmailStatus | undefined): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'sent':
      return 'Sent';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Not sent';
  }
}

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['call', id],
    queryFn: async () => (await api.get(`/calls/${id}`)).data,
    enabled: !!id,
  });

  const { data: transcriptData } = useQuery({
    queryKey: ['call-transcript', id],
    queryFn: async () => (await api.get(`/calls/${id}/transcript`)).data as TranscriptResponse | null,
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.transcriptStatus;
      return status === 'processing' || status === 'draft' ? 5000 : false;
    },
  });

  const emailStatusQuery = useQuery({
    queryKey: ['call-transcript-email-status', id],
    queryFn: async () =>
      (await api.get(`/calls/${id}/transcript-email-status`))
        .data as TranscriptEmailStatusResponse,
    enabled: !!id,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' ? 3000 : false;
    },
  });

  const sendEmailMutation = useMutation<
    TranscriptEmailStatusResponse,
    Error,
    boolean
  >({
    mutationFn: async (resend) =>
      (await api.post(`/calls/${id}/send-transcript-email`, { resend }))
        .data as TranscriptEmailStatusResponse,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['call-transcript-email-status', id],
      });
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Call not found" />;

  const transcript = transcriptData ?? null;
  const segments = transcript?.transcript ?? [];
  const hasStructuredTranscript = segments.length > 0;
  const legacyContent = data.transcript?.content;
  const canSendEmail =
    transcript?.transcriptStatus === 'final' && !sendEmailMutation.isPending;

  return (
    <div className="space-y-6">
      <Link to="/calls" className="text-sm text-indigo-400 hover:underline">← Back to calls</Link>
      <Card title={`Call ${data.id.slice(0, 8)}...`}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Status</dt><dd className="capitalize">{data.status}</dd></div>
          <div><dt className="text-slate-500">Phone</dt><dd>{data.phone}</dd></div>
          <div><dt className="text-slate-500">Customer</dt><dd>{data.customer.firstName} {data.customer.lastName}</dd></div>
          <div><dt className="text-slate-500">Duration</dt><dd>{data.durationSec ? `${data.durationSec}s` : '—'}</dd></div>
        </dl>
      </Card>
      {(hasStructuredTranscript || legacyContent || transcript) && (
        <Card title="Transcript">
          {transcript && (
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>Status: {transcript.transcriptStatus}</span>
              {transcript.transcriptMode && <span>Mode: {transcript.transcriptMode}</span>}
              {transcript.transcriptLanguageDetected && (
                <span>Language: {transcript.transcriptLanguageDetected}</span>
              )}
              {typeof transcript.realtimeTranscriptCount === 'number' && (
                <span>Draft segments: {transcript.realtimeTranscriptCount}</span>
              )}
            </div>
          )}
          {transcript?.transcriptError && (
            <p className="mb-3 text-sm text-amber-400">{transcript.transcriptError}</p>
          )}
          <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  Transcript Email: {emailStatusLabel(emailStatusQuery.data?.status)}
                </p>
                {emailStatusQuery.data?.sentAt && (
                  <p className="text-xs text-slate-500">
                    Sent at {new Date(emailStatusQuery.data.sentAt).toLocaleString()}
                  </p>
                )}
                {emailStatusQuery.data?.recipients?.to?.length ? (
                  <p className="text-xs text-slate-500">
                    To: {emailStatusQuery.data.recipients.to.join(', ')}
                  </p>
                ) : null}
                {emailStatusQuery.isError && (
                  <p className="text-xs text-slate-500">
                    Email status unavailable. Transcript loading is unaffected.
                  </p>
                )}
                {(emailStatusQuery.data?.error || emailStatusQuery.data?.reason) && (
                  <p className="text-xs text-amber-300">
                    {emailStatusQuery.data.error ?? emailStatusQuery.data.reason}
                  </p>
                )}
                {sendEmailMutation.isError && (
                  <p className="text-xs text-red-300">
                    Failed to queue transcript email.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  disabled={!canSendEmail}
                  onClick={() => sendEmailMutation.mutate(false)}
                >
                  {sendEmailMutation.isPending ? 'Queuing...' : 'Send Transcript Email'}
                </Button>
                {emailStatusQuery.data?.status === 'sent' && (
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    disabled={!canSendEmail}
                    onClick={() => sendEmailMutation.mutate(true)}
                  >
                    Resend
                  </Button>
                )}
              </div>
            </div>
          </div>
          {hasStructuredTranscript ? (
            <div className="space-y-3 text-sm text-slate-300">
              {segments.map((segment, index) => (
                <div key={`${segment.source}-${index}`}>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {speakerLabel(segment.speaker)}
                    {segment.status === 'draft' ? ' (draft)' : ''}
                    {segment.source === 'postcall' ? ' · final' : ''}
                  </p>
                  <p className="whitespace-pre-wrap">{segment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-slate-300">
              {transcript?.content ?? legacyContent}
            </p>
          )}
        </Card>
      )}
      {data.summary && (
        <Card title="Summary">
          <p className="text-sm text-slate-300">{data.summary.summary}</p>
          {data.summary.sentiment && (
            <p className="mt-2 text-xs text-slate-500">Sentiment: {data.summary.sentiment}</p>
          )}
        </Card>
      )}
      {data.events?.length > 0 && (
        <Card title="Events">
          <ul className="space-y-2 text-sm text-slate-400">
            {data.events.map((e: { id: string; type: string; createdAt: string }) => (
              <li key={e.id}>{new Date(e.createdAt).toLocaleString()} — {e.type}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
