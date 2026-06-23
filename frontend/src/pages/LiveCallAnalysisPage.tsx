import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card, StatCard } from '../components/ui/Card';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

interface LiveCallAnalysis {
  callId: string;
  status: string;
  phone: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  };
  campaign?: {
    id: string;
    name: string;
  } | null;
  source: string;
  externalRef?: string | null;
  callPurpose?: string | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  transcriptStatus?: string;
  transcriptLanguageDetected?: string | null;
  summary?: string | null;
  sentiment?: string | null;
  outcome: string;
  leadQuality: string;
  nextAction: string;
  callbackRequested: boolean;
  customerRequirements: string[];
  objections: string[];
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatCustomer(call: LiveCallAnalysis) {
  return `${call.customer.firstName} ${call.customer.lastName}`.trim() || 'Unknown customer';
}

function listOrEmpty(items: string[]) {
  if (!items.length) return <span className="text-slate-500">None</span>;
  return (
    <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function badgeClass(value: string) {
  if (['hot', 'interested', 'completed'].includes(value)) {
    return 'bg-emerald-500/10 text-emerald-300';
  }
  if (['warm', 'callback_requested', 'schedule_callback'].includes(value)) {
    return 'bg-amber-500/10 text-amber-300';
  }
  if (['cold', 'not_interested', 'failed'].includes(value)) {
    return 'bg-red-500/10 text-red-300';
  }
  return 'bg-slate-700/50 text-slate-300';
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs ${badgeClass(value)}`}>
      {value}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 text-sm text-slate-200">{value}</div>
    </div>
  );
}

export function LiveCallAnalysisPage() {
  const [selectedAnalysis, setSelectedAnalysis] = useState<LiveCallAnalysis | null>(null);

  const analysisQuery = useQuery({
    queryKey: ['live-call-analysis'],
    queryFn: async () => (await api.get<LiveCallAnalysis[]>('/calls/analysis/live')).data,
    refetchInterval: 10000,
  });

  const stats = useMemo(() => {
    const analyses = analysisQuery.data ?? [];
    return {
      total: analyses.length,
      hot: analyses.filter((analysis) => analysis.leadQuality === 'hot').length,
      callbacks: analyses.filter((analysis) => analysis.callbackRequested).length,
      needsReview: analyses.filter((analysis) => analysis.nextAction === 'review_call').length,
    };
  }, [analysisQuery.data]);

  const selectedJson = selectedAnalysis
    ? {
        outcome: selectedAnalysis.outcome,
        leadQuality: selectedAnalysis.leadQuality,
        nextAction: selectedAnalysis.nextAction,
        callbackRequested: selectedAnalysis.callbackRequested,
        customerRequirements: selectedAnalysis.customerRequirements,
        objections: selectedAnalysis.objections,
      }
    : null;

  if (analysisQuery.isLoading) {
    return <LoadingState />;
  }

  if (analysisQuery.isError) {
    return <ErrorState message="Failed to load live call analysis" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-400">Calls</p>
          <h1 className="text-2xl font-bold text-white">Live Call Analysis</h1>
          <p className="mt-1 text-sm text-slate-400">
            Derived analysis for recent live calls using stored transcripts and summaries.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void analysisQuery.refetch()}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Recent calls" value={stats.total} />
        <StatCard label="Hot leads" value={stats.hot} />
        <StatCard label="Callbacks" value={stats.callbacks} />
        <StatCard label="Needs review" value={stats.needsReview} />
      </div>

      <Card title="Recent Live Call Analysis">
        <Table
          headers={['Customer', 'Phone', 'Outcome', 'Lead Quality', 'Next Action', 'Transcript', 'Date', '']}
          empty={!analysisQuery.data?.length}
        >
          {analysisQuery.data?.map((analysis) => (
            <tr key={analysis.callId} className="text-slate-300">
              <td className="px-4 py-3">
                <div className="font-medium text-white">{formatCustomer(analysis)}</div>
                <div className="text-xs text-slate-500">
                  {analysis.campaign?.name ?? analysis.source}
                </div>
              </td>
              <td className="px-4 py-3">{analysis.phone}</td>
              <td className="px-4 py-3">
                <Badge value={analysis.outcome} />
              </td>
              <td className="px-4 py-3">
                <Badge value={analysis.leadQuality} />
              </td>
              <td className="max-w-xs truncate px-4 py-3">{analysis.nextAction}</td>
              <td className="px-4 py-3 text-xs text-slate-400">
                {analysis.transcriptStatus ?? 'none'}
                {analysis.transcriptLanguageDetected && (
                  <span className="block">Language: {analysis.transcriptLanguageDetected}</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-400">{formatDate(analysis.createdAt)}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setSelectedAnalysis(analysis)}
                  >
                    View
                  </Button>
                  <Link
                    to={`/calls/${analysis.callId}`}
                    className="inline-flex items-center rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Call
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {selectedAnalysis && selectedJson && (
        <Card
          title="Selected Live Call Analysis"
          action={
            <Button variant="secondary" onClick={() => setSelectedAnalysis(null)}>
              Close
            </Button>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <DetailRow label="Customer" value={formatCustomer(selectedAnalysis)} />
            <DetailRow label="Phone" value={selectedAnalysis.phone} />
            <DetailRow label="Summary" value={selectedAnalysis.summary ?? '—'} />
            <DetailRow label="Sentiment" value={selectedAnalysis.sentiment ?? '—'} />
            <DetailRow
              label="Customer Requirements"
              value={listOrEmpty(selectedAnalysis.customerRequirements)}
            />
            <DetailRow label="Objections" value={listOrEmpty(selectedAnalysis.objections)} />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-slate-300">Decision JSON</p>
            <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm text-slate-200">
              {JSON.stringify(selectedJson, null, 2)}
            </pre>
          </div>
        </Card>
      )}
    </div>
  );
}
