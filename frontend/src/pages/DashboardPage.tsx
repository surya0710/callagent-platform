import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { StatCard } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/Table';
import { OverviewMetrics } from '../types';

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: async () => {
      const res = await api.get<OverviewMetrics>('/analytics/overview');
      return res.data;
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load dashboard metrics" />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Customers" value={data?.totalCustomers ?? 0} />
        <StatCard label="Campaigns" value={data?.totalCampaigns ?? 0} />
        <StatCard label="Total Calls" value={data?.totalCalls ?? 0} />
        <StatCard label="Completed Calls" value={data?.completedCalls ?? 0} />
        <StatCard label="Failed Calls" value={data?.failedCalls ?? 0} />
        <StatCard label="Avg Duration (sec)" value={data?.averageCallDuration ?? 0} />
        <StatCard label="Positive Sentiment" value={data?.positiveSentiment ?? 0} />
        <StatCard label="Negative Sentiment" value={data?.negativeSentiment ?? 0} />
      </div>
    </div>
  );
}
