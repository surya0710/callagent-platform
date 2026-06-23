import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import api from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import { Card, StatCard } from '../components/ui/Card';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';
import { Button } from '../components/ui/Button';

interface TrainingRecordingAnalysis {
  id: string;
  trainingRecordingId: string;
  summary?: string;
  outcome?: string;
  leadQuality?: string;
  customerIntent?: string;
  nextAction?: string;
  customerRequirementsJson?: string[];
  objectionsJson?: string[];
  customerQuestionsJson?: string[];
  importantDetailsJson?: string[];
  callbackRequested: boolean;
  callbackDateTime?: string | null;
  executiveScore?: number | null;
  confidence?: number | null;
  status: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  recording?: {
    id: string;
    originalFileName: string;
    language?: string | null;
    labelOutcome?: string | null;
    status: string;
  };
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatList(items?: string[]) {
  if (!items?.length) {
    return <span className="text-slate-500">None</span>;
  }

  return (
    <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-emerald-500/10 text-emerald-300';
  if (status === 'failed') return 'bg-red-500/10 text-red-300';
  return 'bg-amber-500/10 text-amber-300';
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 text-sm text-slate-200">{value}</div>
    </div>
  );
}

export function CallAnalysisPage() {
  const [selectedAnalysis, setSelectedAnalysis] = useState<TrainingRecordingAnalysis | null>(
    null,
  );

  const analyses = useQuery({
    queryKey: ['training-analysis'],
    queryFn: async () =>
      (await api.get<TrainingRecordingAnalysis[]>('/training/analysis')).data,
    refetchInterval: (query) => {
      const hasProcessing = query.state.data?.some(
        (analysis) => analysis.status === 'processing' || analysis.status === 'pending',
      );
      return hasProcessing ? 5000 : false;
    },
  });

  const stats = useMemo(() => {
    const items = analyses.data ?? [];
    return {
      total: items.length,
      hot: items.filter((item) => item.leadQuality === 'hot').length,
      interested: items.filter((item) => item.outcome === 'interested').length,
      callbacks: items.filter((item) => item.callbackRequested).length,
    };
  }, [analyses.data]);

  const selectedJson = selectedAnalysis
    ? {
        outcome: selectedAnalysis.outcome ?? null,
        leadQuality: selectedAnalysis.leadQuality ?? null,
        nextAction: selectedAnalysis.nextAction ?? null,
        callbackRequested: selectedAnalysis.callbackRequested,
        customerRequirements: selectedAnalysis.customerRequirementsJson ?? [],
        objections: selectedAnalysis.objectionsJson ?? [],
      }
    : null;

  if (analyses.isLoading) {
    return <LoadingState />;
  }

  if (analyses.isError) {
    return <ErrorState message="Failed to load call analysis" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Training</p>
        <h1 className="text-2xl font-bold text-white">Call Analysis</h1>
        <p className="mt-1 text-sm text-slate-400">
          Review AI-generated outcomes, lead quality, next action, callbacks,
          requirements, and objections from analyzed training recordings.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total analyses" value={stats.total} />
        <StatCard label="Hot leads" value={stats.hot} />
        <StatCard label="Interested" value={stats.interested} />
        <StatCard label="Callbacks" value={stats.callbacks} />
      </div>

      <Card title="Analyzed Calls">
        <Table headers={['Recording', 'Outcome', 'Lead Quality', 'Next Action', 'Callback', 'Status', 'Updated', '']} empty={!analyses.data?.length}>
          {analyses.data?.map((analysis) => (
            <tr key={analysis.id} className="text-slate-300">
              <td className="px-4 py-3">
                <div className="font-medium text-white">
                  {analysis.recording?.originalFileName ?? analysis.trainingRecordingId}
                </div>
                <div className="text-xs text-slate-500">
                  {analysis.recording?.language ?? 'language unknown'}
                </div>
              </td>
              <td className="px-4 py-3">{analysis.outcome ?? '—'}</td>
              <td className="px-4 py-3">{analysis.leadQuality ?? '—'}</td>
              <td className="max-w-xs truncate px-4 py-3">{analysis.nextAction ?? '—'}</td>
              <td className="px-4 py-3">
                {analysis.callbackRequested ? (
                  <span className="text-amber-300">Yes</span>
                ) : (
                  <span className="text-slate-500">No</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-1 text-xs ${statusClass(analysis.status)}`}>
                  {analysis.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-400">{formatDate(analysis.updatedAt)}</td>
              <td className="px-4 py-3 text-right">
                <Button variant="secondary" onClick={() => setSelectedAnalysis(analysis)}>
                  View
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {selectedAnalysis && selectedJson && (
        <Card
          title="Selected Analysis"
          action={
            <Button variant="secondary" onClick={() => setSelectedAnalysis(null)}>
              Close
            </Button>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <DetailRow
              label="Recording"
              value={selectedAnalysis.recording?.originalFileName ?? selectedAnalysis.trainingRecordingId}
            />
            <DetailRow label="Summary" value={selectedAnalysis.summary ?? '—'} />
            <DetailRow label="Customer Intent" value={selectedAnalysis.customerIntent ?? '—'} />
            <DetailRow label="Next Action" value={selectedAnalysis.nextAction ?? '—'} />
            <DetailRow label="Customer Requirements" value={formatList(selectedAnalysis.customerRequirementsJson)} />
            <DetailRow label="Objections" value={formatList(selectedAnalysis.objectionsJson)} />
            <DetailRow label="Customer Questions" value={formatList(selectedAnalysis.customerQuestionsJson)} />
            <DetailRow label="Important Details" value={formatList(selectedAnalysis.importantDetailsJson)} />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-slate-300">Decision JSON</p>
            <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm text-slate-200">
              {JSON.stringify(selectedJson, null, 2)}
            </pre>
          </div>

          {selectedAnalysis.error && (
            <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
              {selectedAnalysis.error}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
