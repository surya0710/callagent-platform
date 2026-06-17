import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Textarea } from '../components/ui/Modal';
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

interface AgentPlaybook {
  id: string;
  title: string;
  description?: string | null;
  sourceInsightReportId?: string | null;
  status: 'draft' | 'approved' | 'active' | 'archived';
  version: number;
  playbookText: string;
  agentInstructions: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

function PlaybookStatusBadge({ status }: { status: AgentPlaybook['status'] }) {
  const classes = {
    draft: 'border-slate-700 text-slate-300',
    approved: 'border-amber-700 bg-amber-900/20 text-amber-300',
    active: 'border-emerald-700 bg-emerald-900/20 text-emerald-300',
    archived: 'border-slate-800 bg-slate-950 text-slate-500',
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${classes[status]}`}
    >
      {status}
    </span>
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
  const [editingPlaybook, setEditingPlaybook] = useState<AgentPlaybook | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    playbookText: '',
    agentInstructions: '',
  });

  const report = useQuery({
    queryKey: ['training-insights-latest'],
    queryFn: async () => {
      const { data } = await api.get<TrainingInsightReport | null>('/training/insights/latest');
      return data;
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' ? 5000 : false,
  });

  const playbooks = useQuery({
    queryKey: ['training-playbooks'],
    queryFn: async () => {
      const { data } = await api.get<AgentPlaybook[]>('/training/playbooks');
      return data;
    },
  });

  const activePlaybook = playbooks.data?.find((playbook) => playbook.status === 'active');

  const refreshPlaybooks = () => {
    queryClient.invalidateQueries({ queryKey: ['training-playbooks'] });
  };

  const generateMutation = useMutation({
    mutationFn: () => api.post('/training/insights/generate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-insights-latest'] });
    },
  });

  const createPlaybookMutation = useMutation({
    mutationFn: (insightReportId: string) =>
      api.post(`/training/playbooks/from-insight/${insightReportId}`),
    onSuccess: refreshPlaybooks,
  });

  const approvePlaybookMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/playbooks/${id}/approve`),
    onSuccess: refreshPlaybooks,
  });

  const activatePlaybookMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/playbooks/${id}/activate`),
    onSuccess: refreshPlaybooks,
  });

  const archivePlaybookMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/playbooks/${id}/archive`),
    onSuccess: refreshPlaybooks,
  });

  const duplicatePlaybookMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/playbooks/${id}/duplicate`),
    onSuccess: refreshPlaybooks,
  });

  const updatePlaybookMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        title: string;
        description: string | null;
        playbookText: string;
        agentInstructions: string;
      };
    }) => api.patch(`/training/playbooks/${id}`, body),
    onSuccess: () => {
      refreshPlaybooks();
      setEditingPlaybook(null);
    },
  });

  if (report.isLoading) return <LoadingState />;

  const data = report.data;
  const hotSignals = data?.qualificationSignalsJson?.hotLeadSignals ?? [];
  const coldSignals = data?.qualificationSignalsJson?.coldLeadSignals ?? [];
  const isPlaybookActionPending =
    createPlaybookMutation.isPending ||
    approvePlaybookMutation.isPending ||
    activatePlaybookMutation.isPending ||
    archivePlaybookMutation.isPending ||
    duplicatePlaybookMutation.isPending ||
    updatePlaybookMutation.isPending;

  const openEditPlaybook = (playbook: AgentPlaybook) => {
    setEditingPlaybook(playbook);
    setEditForm({
      title: playbook.title,
      description: playbook.description ?? '',
      playbookText: playbook.playbookText,
      agentInstructions: playbook.agentInstructions,
    });
  };

  const handleEditSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingPlaybook) return;
    updatePlaybookMutation.mutate({
      id: editingPlaybook.id,
      body: {
        title: editForm.title,
        description: editForm.description.trim() || null,
        playbookText: editForm.playbookText,
        agentInstructions: editForm.agentInstructions,
      },
    });
  };

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
      {playbooks.error && <ErrorState message="Failed to load AI playbooks" />}

      <Card title="Live AI Playbook">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 p-3 text-sm text-slate-300">
            <div className="grid gap-2 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase text-slate-500">Draft</div>
                <div>Editable only. Not used by live AI.</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Approved</div>
                <div>Reviewed, but not live yet.</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Active</div>
                <div>Currently injected into live AI calls.</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Archived</div>
                <div>Historical version only.</div>
              </div>
            </div>
          </div>

          {activePlaybook ? (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlaybookStatusBadge status="active" />
                <span className="font-medium text-white">{activePlaybook.title}</span>
                <span className="text-sm text-slate-400">v{activePlaybook.version}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                This playbook is currently used by the live OpenAI Realtime voice agent.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              No active AI playbook. Live calls are using the existing runtime instructions.
            </p>
          )}

          {data && ['completed', 'approved'].includes(data.status) && (
            <Button
              type="button"
              disabled={createPlaybookMutation.isPending}
              onClick={() => createPlaybookMutation.mutate(data.id)}
            >
              {createPlaybookMutation.isPending
                ? 'Creating...'
                : 'Create Playbook from This Insight Report'}
            </Button>
          )}
        </div>
      </Card>

      {playbooks.data && playbooks.data.length > 0 && (
        <Card title="Training Playbooks">
          <div className="space-y-4">
            {playbooks.data.map((playbook) => (
              <div
                key={playbook.id}
                className="rounded-lg border border-slate-800 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <PlaybookStatusBadge status={playbook.status} />
                      <h3 className="font-medium text-white">{playbook.title}</h3>
                      <span className="text-sm text-slate-400">v{playbook.version}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {playbook.description || 'No description'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Updated {new Date(playbook.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton text={playbook.agentInstructions} label="Agent Instructions" />
                    {playbook.status === 'draft' && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={isPlaybookActionPending}
                          onClick={() => openEditPlaybook(playbook)}
                        >
                          Edit Draft
                        </Button>
                        <Button
                          type="button"
                          disabled={isPlaybookActionPending}
                          onClick={() => approvePlaybookMutation.mutate(playbook.id)}
                        >
                          Approve
                        </Button>
                      </>
                    )}
                    {playbook.status === 'approved' && (
                      <Button
                        type="button"
                        disabled={isPlaybookActionPending}
                        onClick={() => activatePlaybookMutation.mutate(playbook.id)}
                      >
                        Set Active AI Playbook
                      </Button>
                    )}
                    {playbook.status !== 'active' && playbook.status !== 'archived' && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isPlaybookActionPending}
                        onClick={() => archivePlaybookMutation.mutate(playbook.id)}
                      >
                        Archive
                      </Button>
                    )}
                    {playbook.status === 'active' && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isPlaybookActionPending}
                        onClick={() => duplicatePlaybookMutation.mutate(playbook.id)}
                      >
                        Copy to New Version
                      </Button>
                    )}
                    {playbook.status !== 'active' && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isPlaybookActionPending}
                        onClick={() => duplicatePlaybookMutation.mutate(playbook.id)}
                      >
                        Duplicate
                      </Button>
                    )}
                  </div>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-indigo-300">
                    View generated playbook
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-sm text-slate-300">
                    {playbook.playbookText}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </Card>
      )}

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

      <Modal
        title="Edit Draft Playbook"
        open={Boolean(editingPlaybook)}
        onClose={() => setEditingPlaybook(null)}
        wide
      >
        <form className="space-y-4" onSubmit={handleEditSubmit}>
          <Input
            label="Title"
            value={editForm.title}
            onChange={(event) =>
              setEditForm((current) => ({ ...current, title: event.target.value }))
            }
            required
          />
          <Textarea
            label="Description"
            value={editForm.description}
            onChange={(event) =>
              setEditForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
          <Textarea
            label="Playbook Text"
            rows={10}
            value={editForm.playbookText}
            onChange={(event) =>
              setEditForm((current) => ({
                ...current,
                playbookText: event.target.value,
              }))
            }
            required
          />
          <Textarea
            label="Agent Instructions"
            rows={10}
            value={editForm.agentInstructions}
            onChange={(event) =>
              setEditForm((current) => ({
                ...current,
                agentInstructions: event.target.value,
              }))
            }
            required
          />
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingPlaybook(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updatePlaybookMutation.isPending}>
              {updatePlaybookMutation.isPending ? 'Saving...' : 'Save Draft'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
