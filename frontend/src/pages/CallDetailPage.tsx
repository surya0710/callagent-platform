import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/Table';

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['call', id],
    queryFn: async () => (await api.get(`/calls/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Call not found" />;

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
      {data.transcript && (
        <Card title="Transcript">
          <p className="whitespace-pre-wrap text-sm text-slate-300">{data.transcript.content}</p>
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
