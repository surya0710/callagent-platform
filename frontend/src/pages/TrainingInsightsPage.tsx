import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/Table';

interface ObjectionInsight {
  objection: string;
  count: number;
  bestResponses: string[];
}

interface PhraseInsight {
  phrase: string;
  count: number;
  context?: string;
  reason?: string;
}

interface OpeningInsight {
  style: string;
  example: string;
  count: number;
}

interface FollowUpPattern {
  pattern: string;
  description: string;
}

interface TrainingInsightReport {
  id: string;
  title: string;
  status: string;
  totalCalls: number;
  commonObjectionsJson?: ObjectionInsight[];
  commonQuestionsJson?: Array<{ question: string; count: number }>;
  commonRequirementsJson?: Array<{ requirement: string; count: number }>;
  winningPhrasesJson?: PhraseInsight[];
  badPhrasesJson?: PhraseInsight[];
  bestOpeningsJson?: OpeningInsight[];
  followUpPatternsJson?: FollowUpPattern[];
  qualificationSignalsJson?: {
    hotLeadSignals?: string[];
    coldLeadSignals?: string[];
  };
  recommendedPlaybook?: string;
  aiAgentInstructions?: string;
  createdAt: string;
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-2 font-medium text-white">{title}</h4>
      <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <Button type="button" onClick={handleCopy}>
      Copy {label}
    </Button>
  );
}

export function TrainingInsightsPage() {
  const queryClient = useQueryClient();

  const report = useQuery({
    queryKey: ['training-insights-latest'],
    queryFn: async () => {
      const { data } = await api.get<TrainingInsightReport | null>('/training/insights/latest');
      return data;
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' ? 5000 : false,
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/training/insights/generate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-insights-latest'] });
    },
  });

  if (report.isLoading) return <LoadingState />;

  const data = report.data;
  const hotSignals = data?.qualificationSignalsJson?.hotLeadSignals ?? [];
  const coldSignals = data?.qualificationSignalsJson?.coldLeadSignals ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Training Insights</h1>
          <p className="text-sm text-slate-400">
            Aggregate business intelligence from analyzed executive calls
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/training">
            <Button type="button">Back to Training</Button>
          </Link>
          <Button
            type="button"
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate Insights'}
          </Button>
        </div>
      </div>

      {report.error && <ErrorState message="Failed to load insights report" />}

      {!data && !report.error && (
        <Card title="No report yet">
          <p className="text-slate-300">
            Analyze training call transcripts first, then generate aggregate insights.
          </p>
        </Card>
      )}

      {data && (
        <>
          <Card title={data.title}>
            <div className="flex flex-wrap gap-4 text-sm text-slate-300">
              <span>Status: {data.status}</span>
              <span>Calls analyzed: {data.totalCalls}</span>
              <span>Generated: {new Date(data.createdAt).toLocaleString()}</span>
            </div>
            {data.status === 'processing' && (
              <p className="mt-3 text-amber-300">Report is being generated...</p>
            )}
          </Card>

          {data.status === 'completed' && (
            <>
              <div className="grid gap-6 xl:grid-cols-2">
                <Card title="Common Objections">
                  {!data.commonObjectionsJson?.length ? (
                    <p className="text-slate-400">None identified</p>
                  ) : (
                    <div className="space-y-4">
                      {data.commonObjectionsJson.map((item) => (
                        <div key={item.objection} className="rounded-lg border border-slate-800 p-3">
                          <div className="font-medium text-white">
                            {item.objection}{' '}
                            <span className="text-slate-400">({item.count})</span>
                          </div>
                          {item.bestResponses?.length > 0 && (
                            <div className="mt-2">
                              <div className="text-xs uppercase text-slate-500">Best responses</div>
                              <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                                {item.bestResponses.map((r) => (
                                  <li key={r}>{r}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Common Customer Questions">
                  {!data.commonQuestionsJson?.length ? (
                    <p className="text-slate-400">None identified</p>
                  ) : (
                    <ul className="space-y-2 text-sm text-slate-300">
                      {data.commonQuestionsJson.map((item) => (
                        <li key={item.question}>
                          {item.question} <span className="text-slate-500">({item.count})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Common Requirements">
                  {!data.commonRequirementsJson?.length ? (
                    <p className="text-slate-400">None identified</p>
                  ) : (
                    <ul className="space-y-2 text-sm text-slate-300">
                      {data.commonRequirementsJson.map((item) => (
                        <li key={item.requirement}>
                          {item.requirement} <span className="text-slate-500">({item.count})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Winning Phrases">
                  {!data.winningPhrasesJson?.length ? (
                    <p className="text-slate-400">None identified</p>
                  ) : (
                    <ul className="space-y-3 text-sm text-slate-300">
                      {data.winningPhrasesJson.map((item) => (
                        <li key={item.phrase}>
                          <span className="text-emerald-300">&ldquo;{item.phrase}&rdquo;</span>{' '}
                          <span className="text-slate-500">({item.count})</span>
                          {item.context && (
                            <div className="text-xs text-slate-500">{item.context}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Phrases to Avoid">
                  {!data.badPhrasesJson?.length ? (
                    <p className="text-slate-400">None identified</p>
                  ) : (
                    <ul className="space-y-3 text-sm text-slate-300">
                      {data.badPhrasesJson.map((item) => (
                        <li key={item.phrase}>
                          <span className="text-red-300">&ldquo;{item.phrase}&rdquo;</span>{' '}
                          <span className="text-slate-500">({item.count})</span>
                          {item.reason && (
                            <div className="text-xs text-slate-500">{item.reason}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Best Opening Styles">
                  {!data.bestOpeningsJson?.length ? (
                    <p className="text-slate-400">None identified</p>
                  ) : (
                    <ul className="space-y-3 text-sm text-slate-300">
                      {data.bestOpeningsJson.map((item) => (
                        <li key={`${item.style}-${item.example}`}>
                          <div className="font-medium text-white">{item.style}</div>
                          <div className="italic">&ldquo;{item.example}&rdquo;</div>
                          <div className="text-xs text-slate-500">Seen {item.count} times</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card title="Follow-up Patterns">
                {!data.followUpPatternsJson?.length ? (
                  <p className="text-slate-400">None identified</p>
                ) : (
                  <div className="space-y-3">
                    {data.followUpPatternsJson.map((item) => (
                      <div key={item.pattern} className="rounded-lg border border-slate-800 p-3">
                        <div className="font-medium text-white">{item.pattern}</div>
                        <div className="text-sm text-slate-300">{item.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div className="grid gap-6 xl:grid-cols-2">
                <Card title="Lead Signals">
                  <div className="space-y-4">
                    <ListSection title="Hot lead signals" items={hotSignals} />
                    <ListSection title="Cold lead signals" items={coldSignals} />
                  </div>
                </Card>

                <Card title="Actions">
                  <div className="flex flex-wrap gap-3">
                    {data.recommendedPlaybook && (
                      <CopyButton text={data.recommendedPlaybook} label="Playbook" />
                    )}
                    {data.aiAgentInstructions && (
                      <CopyButton text={data.aiAgentInstructions} label="AI Instructions" />
                    )}
                  </div>
                </Card>
              </div>

              {data.recommendedPlaybook && (
                <Card title="Recommended Sales Playbook">
                  <pre className="whitespace-pre-wrap text-sm text-slate-300">
                    {data.recommendedPlaybook}
                  </pre>
                </Card>
              )}

              {data.aiAgentInstructions && (
                <Card title="Recommended AI Agent Instructions">
                  <pre className="whitespace-pre-wrap text-sm text-slate-300">
                    {data.aiAgentInstructions}
                  </pre>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
