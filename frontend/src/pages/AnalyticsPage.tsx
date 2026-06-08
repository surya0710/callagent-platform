import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../lib/api';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/Table';

export function AnalyticsPage() {
  const calls = useQuery({
    queryKey: ['analytics-calls'],
    queryFn: async () => (await api.get('/analytics/calls')).data,
  });

  const sentiment = useQuery({
    queryKey: ['analytics-sentiment'],
    queryFn: async () => (await api.get('/analytics/sentiment')).data,
  });

  if (calls.isLoading || sentiment.isLoading) return <LoadingState />;
  if (calls.error || sentiment.error) return <ErrorState message="Failed to load analytics" />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Analytics</h1>

      <Card title="Calls by Status">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={calls.data?.byStatus ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="status" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Sentiment Breakdown">
        <div className="grid gap-4 sm:grid-cols-3">
          {sentiment.data?.breakdown?.map((s: { sentiment: string; count: number; percentage: number }) => (
            <div key={s.sentiment} className="rounded-lg border border-slate-800 p-4">
              <p className="capitalize text-slate-400">{s.sentiment ?? 'unknown'}</p>
              <p className="text-2xl font-bold text-white">{s.count}</p>
              <p className="text-xs text-slate-500">{s.percentage}%</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
