import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Select, Textarea } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

const TRAINING_LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish (Hindi + English mixed)' },
];

interface TrainingRecording {
  id: string;
  originalFileName: string;
  status: string;
  language?: string;
  labelOutcome?: string;
  transcript?: string;
  redactedTranscript?: string;
  expectedResponse?: string;
  trainingApproved: boolean;
  errorMessage?: string;
  createdAt: string;
}

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
  callbackDateTime?: string;
  executiveScore?: number;
  executiveStrengthsJson?: string[];
  executiveImprovementsJson?: string[];
  missedOpportunitiesJson?: string[];
  winningPhrasesJson?: string[];
  badPhrasesJson?: string[];
  confidence?: number;
  status: string;
  error?: string;
  recording?: {
    id: string;
    originalFileName: string;
    language?: string;
    labelOutcome?: string;
    status: string;
  };
}

function stringList(items?: string[]) {
  if (!items?.length) return <span className="text-slate-500">None</span>;
  return (
    <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function isTranscribed(recording: TrainingRecording) {
  return Boolean(
    recording.transcript &&
      (recording.status === 'transcribed' || recording.status === 'approved'),
  );
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { data?: { message?: string | string[] } } }).response?.data
      ?.message === 'string'
  ) {
    return (error as { response: { data: { message: string } } }).response.data.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    Array.isArray(
      (error as { response?: { data?: { message?: string | string[] } } }).response?.data
        ?.message,
    )
  ) {
    return (
      (error as { response: { data: { message: string[] } } }).response.data.message as string[]
    ).join(', ');
  }

  return fallback;
}

interface TrainingDataset {
  id: string;
  name: string;
  status: string;
  exampleCount: number;
  openAiFileId?: string;
  createdAt: string;
}

interface TrainingJob {
  id: string;
  provider: string;
  baseModel: string;
  status: string;
  openAiJobId?: string;
  fineTunedModel?: string;
  errorMessage?: string;
  dataset?: { name: string; exampleCount: number };
}

export function TrainingPage() {
  const queryClient = useQueryClient();
  const [approveRecording, setApproveRecording] = useState<TrainingRecording | null>(null);
  const [editRecording, setEditRecording] = useState<TrainingRecording | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [approveError, setApproveError] = useState('');
  const [editError, setEditError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [datasetError, setDatasetError] = useState('');
  const [transcribeError, setTranscribeError] = useState('');
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewAnalysis, setViewAnalysis] = useState<TrainingRecordingAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');

  const recordings = useQuery({
    queryKey: ['training-recordings'],
    queryFn: async () => (await api.get<TrainingRecording[]>('/training/recordings')).data,
  });

  const datasets = useQuery({
    queryKey: ['training-datasets'],
    queryFn: async () => (await api.get<TrainingDataset[]>('/training/datasets')).data,
  });

  const jobs = useQuery({
    queryKey: ['training-jobs'],
    queryFn: async () => (await api.get<TrainingJob[]>('/training/jobs')).data,
  });

  const analyses = useQuery({
    queryKey: ['training-analysis'],
    queryFn: async () =>
      (await api.get<TrainingRecordingAnalysis[]>('/training/analysis')).data,
    refetchInterval: (query) => {
      const hasProcessing = query.state.data?.some(
        (a) => a.status === 'processing' || a.status === 'pending',
      );
      return hasProcessing ? 5000 : false;
    },
  });

  const analysisByRecordingId = useMemo(() => {
    const map = new Map<string, TrainingRecordingAnalysis>();
    analyses.data?.forEach((a) => map.set(a.trainingRecordingId, a));
    return map;
  }, [analyses.data]);

  const invalidateTraining = () => {
    queryClient.invalidateQueries({ queryKey: ['training-recordings'] });
    queryClient.invalidateQueries({ queryKey: ['training-datasets'] });
    queryClient.invalidateQueries({ queryKey: ['training-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['training-analysis'] });
  };

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) =>
      api.post('/training/recordings/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    onSuccess: () => {
      setUploadError('');
      invalidateTraining();
    },
    onError: () => setUploadError('Failed to upload recording'),
  });

  const transcribeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/recordings/${id}/transcribe`),
    onMutate: (id) => {
      setTranscribingId(id);
      setTranscribeError('');
    },
    onSuccess: () => {
      setTranscribeError('');
      invalidateTraining();
    },
    onError: (error) => {
      setTranscribeError(getApiErrorMessage(error, 'Transcription failed'));
    },
    onSettled: () => {
      setTranscribingId(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        language?: string;
        labelOutcome?: string;
        transcript?: string;
        redactedTranscript?: string;
        expectedResponse?: string;
        resetTranscription?: boolean;
      };
    }) => api.patch(`/training/recordings/${id}`, body),
    onSuccess: () => {
      setEditError('');
      setEditRecording(null);
      invalidateTraining();
    },
    onError: (error) => {
      setEditError(getApiErrorMessage(error, 'Failed to update recording'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/training/recordings/${id}`),
    onSuccess: () => {
      setDeleteError('');
      invalidateTraining();
    },
    onError: (error) => {
      setDeleteError(getApiErrorMessage(error, 'Failed to delete recording'));
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { labelOutcome: string; expectedResponse: string; redactedTranscript?: string };
    }) => api.patch(`/training/recordings/${id}/approve`, body),
    onSuccess: () => {
      setApproveError('');
      setApproveRecording(null);
      invalidateTraining();
    },
    onError: () => setApproveError('Failed to approve training example'),
  });

  const datasetMutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api.post('/training/datasets', body),
    onSuccess: () => {
      setDatasetError('');
      invalidateTraining();
    },
    onError: () => setDatasetError('Failed to create dataset. Approve at least one transcript first.'),
  });

  const fineTuneMutation = useMutation({
    mutationFn: (datasetId: string) => api.post(`/training/datasets/${datasetId}/fine-tune`, {}),
    onSuccess: invalidateTraining,
  });

  const refreshJobMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/training/jobs/${jobId}/refresh`),
    onSuccess: invalidateTraining,
  });

  const analyzeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/recordings/${id}/analyze`),
    onSuccess: () => {
      setAnalysisError('');
      invalidateTraining();
    },
    onError: (error) => {
      setAnalysisError(getApiErrorMessage(error, 'Failed to queue analysis'));
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/training/recordings/${id}/reanalyze`),
    onSuccess: () => {
      setAnalysisError('');
      invalidateTraining();
    },
    onError: (error) => {
      setAnalysisError(getApiErrorMessage(error, 'Failed to re-analyze'));
    },
  });

  const analyzeAllMutation = useMutation({
    mutationFn: (recordingIds?: string[]) =>
      api.post(
        '/training/recordings/analyze-all',
        recordingIds?.length ? { recordingIds } : {},
      ),
    onSuccess: () => {
      setAnalysisError('');
      setSelectedIds([]);
      invalidateTraining();
    },
    onError: (error) => {
      setAnalysisError(getApiErrorMessage(error, 'Failed to analyze calls'));
    },
  });

  const openAnalysis = async (recordingId: string) => {
    try {
      const { data } = await api.get<TrainingRecordingAnalysis>(
        `/training/recordings/${recordingId}/analysis`,
      );
      setViewAnalysis(data);
    } catch {
      setAnalysisError('Analysis not available yet for this recording');
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleSelectAllTranscribed = () => {
    const transcribedIds =
      recordings.data?.filter(isTranscribed).map((r) => r.id) ?? [];
    const allSelected = transcribedIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : transcribedIds);
  };

  const handleUpload = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    uploadMutation.mutate(fd);
    e.currentTarget.reset();
  };

  const handleEdit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editRecording) return;
    const fd = new FormData(e.currentTarget);
    const resetTranscription = fd.get('resetTranscription') === 'on';

    updateMutation.mutate({
      id: editRecording.id,
      body: {
        language: (fd.get('language') as string) || undefined,
        labelOutcome: (fd.get('labelOutcome') as string) || undefined,
        transcript: resetTranscription
          ? undefined
          : (fd.get('transcript') as string) || undefined,
        redactedTranscript: resetTranscription
          ? undefined
          : (fd.get('redactedTranscript') as string) || undefined,
        expectedResponse: resetTranscription
          ? undefined
          : (fd.get('expectedResponse') as string) || undefined,
        resetTranscription,
      },
    });
  };

  const handleDelete = (recording: TrainingRecording) => {
    if (
      !window.confirm(
        `Delete "${recording.originalFileName}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    deleteMutation.mutate(recording.id);
  };

  const handleApprove = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!approveRecording) return;
    const fd = new FormData(e.currentTarget);
    approveMutation.mutate({
      id: approveRecording.id,
      body: {
        labelOutcome: fd.get('labelOutcome') as string,
        expectedResponse: fd.get('expectedResponse') as string,
        redactedTranscript: (fd.get('redactedTranscript') as string) || undefined,
      },
    });
  };

  const handleCreateDataset = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    datasetMutation.mutate({
      name: fd.get('name') as string,
      description: (fd.get('description') as string) || undefined,
    });
    e.currentTarget.reset();
  };

  if (recordings.isLoading || datasets.isLoading || jobs.isLoading) return <LoadingState />;
  if (recordings.error || datasets.error || jobs.error) {
    return <ErrorState message="Failed to load training data" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Training</h1>
          <p className="text-sm text-slate-400">
            Upload executive calls, transcribe, analyze, and build fine-tuning datasets
          </p>
        </div>
        <Link to="/training/insights">
          <Button type="button">View Aggregate Insights</Button>
        </Link>
      </div>

      <Card title="Call Intelligence">
        {analysisError && (
          <div className="mb-4">
            <ErrorState message={analysisError} />
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={
              !selectedIds.length ||
              analyzeAllMutation.isPending ||
              analyzeMutation.isPending
            }
            onClick={() => analyzeAllMutation.mutate(selectedIds)}
          >
            Analyze Selected ({selectedIds.length})
          </Button>
          <Button
            type="button"
            disabled={analyzeAllMutation.isPending}
            onClick={() => analyzeAllMutation.mutate(undefined)}
          >
            {analyzeAllMutation.isPending ? 'Analyzing...' : 'Analyze All Calls'}
          </Button>
          <Button
            type="button"
            disabled={analyzeAllMutation.isPending}
            onClick={toggleSelectAllTranscribed}
          >
            Select All Transcribed
          </Button>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          {analyses.data?.filter((a) => a.status === 'completed').length ?? 0} of{' '}
          {recordings.data?.filter(isTranscribed).length ?? 0} transcribed calls analyzed
        </p>
      </Card>

      <Card title="Training Upload">
        <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-[1fr_160px_160px_auto]">
          {uploadError && <div className="md:col-span-4"><ErrorState message={uploadError} /></div>}
          <Input label="Recording" name="file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4" required />
          <Select label="Language" name="language" defaultValue="">
            {TRAINING_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value || 'auto'} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Input label="Outcome" name="labelOutcome" placeholder="interested" />
          <div className="flex items-end">
            <Button type="submit" disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Recordings">
        {transcribeError && <div className="mb-4"><ErrorState message={transcribeError} /></div>}
        {deleteError && <div className="mb-4"><ErrorState message={deleteError} /></div>}
        <Table
          headers={['', 'File', 'Language', 'Status', 'Analysis', 'Outcome', 'Approved', 'Actions']}
          empty={!recordings.data?.length}
        >
          {recordings.data?.map((recording) => {
            const transcribed = isTranscribed(recording);
            const isTranscribing = transcribingId === recording.id;
            const canTranscribe = !transcribed && !isTranscribing;
            const analysis = analysisByRecordingId.get(recording.id);

            return (
              <tr key={recording.id} className="text-slate-300">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(recording.id)}
                    disabled={!transcribed}
                    onChange={() => toggleSelected(recording.id)}
                    className="rounded border-slate-600"
                  />
                </td>
                <td className="px-4 py-3">
                  <div>{recording.originalFileName}</div>
                  {recording.expectedResponse && (
                    <div className="mt-1 max-w-md truncate text-xs text-slate-500">
                      Expected: {recording.expectedResponse}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 capitalize">{recording.language ?? 'auto'}</td>
                <td className="px-4 py-3">
                  <div>{recording.status}</div>
                  {recording.errorMessage && (
                    <div className="mt-1 text-xs text-red-300">{recording.errorMessage}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!transcribed ? (
                    <span className="text-slate-500">—</span>
                  ) : analysis?.status === 'completed' ? (
                    <button
                      onClick={() => openAnalysis(recording.id)}
                      className="text-emerald-400 hover:underline"
                    >
                      View ({analysis.leadQuality ?? analysis.outcome})
                    </button>
                  ) : analysis?.status === 'processing' || analysis?.status === 'pending' ? (
                    <span className="text-amber-300">Processing...</span>
                  ) : analysis?.status === 'failed' ? (
                    <span className="text-red-300" title={analysis.error}>
                      Failed
                    </span>
                  ) : (
                    <span className="text-slate-500">Not analyzed</span>
                  )}
                </td>
                <td className="px-4 py-3">{recording.labelOutcome ?? analysis?.outcome ?? '-'}</td>
                <td className="px-4 py-3">{recording.trainingApproved ? 'Yes' : 'No'}</td>
                <td className="space-x-3 px-4 py-3">
                  {isTranscribing ? (
                    <span className="inline-flex items-center gap-2 text-amber-300">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
                      Transcribing...
                    </span>
                  ) : transcribed ? (
                    <span className="text-slate-500">Transcribed</span>
                  ) : (
                    <button
                      onClick={() => transcribeMutation.mutate(recording.id)}
                      className="text-indigo-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500"
                      disabled={!canTranscribe || transcribeMutation.isPending}
                    >
                      {recording.status === 'failed' ? 'Retry Transcribe' : 'Transcribe'}
                    </button>
                  )}
                  <button
                    onClick={() => setApproveRecording(recording)}
                    className="text-indigo-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500"
                    disabled={!transcribed}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setEditRecording(recording)}
                    className="text-indigo-400 hover:underline"
                  >
                    Edit
                  </button>
                  {transcribed && (
                    <>
                      {!analysis || analysis.status === 'failed' ? (
                        <button
                          onClick={() => analyzeMutation.mutate(recording.id)}
                          className="text-indigo-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500"
                          disabled={analyzeMutation.isPending}
                        >
                          Analyze
                        </button>
                      ) : (
                        <button
                          onClick={() => reanalyzeMutation.mutate(recording.id)}
                          className="text-indigo-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500"
                          disabled={reanalyzeMutation.isPending}
                        >
                          Regenerate
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(recording)}
                    className="text-red-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500"
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card title="Create Dataset">
          <form onSubmit={handleCreateDataset} className="space-y-4">
            {datasetError && <ErrorState message={datasetError} />}
            <Input label="Name" name="name" required />
            <Input label="Description" name="description" />
            <Button type="submit" disabled={datasetMutation.isPending}>
              {datasetMutation.isPending ? 'Creating...' : 'Create JSONL Dataset'}
            </Button>
          </form>
        </Card>

        <Card title="Datasets">
          <Table headers={['Name', 'Examples', 'Status', 'OpenAI File', '']} empty={!datasets.data?.length}>
            {datasets.data?.map((dataset) => (
              <tr key={dataset.id} className="text-slate-300">
                <td className="px-4 py-3">{dataset.name}</td>
                <td className="px-4 py-3">{dataset.exampleCount}</td>
                <td className="px-4 py-3">{dataset.status}</td>
                <td className="px-4 py-3">{dataset.openAiFileId ?? '-'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => fineTuneMutation.mutate(dataset.id)}
                    className="text-indigo-400 hover:underline"
                    disabled={fineTuneMutation.isPending}
                  >
                    Start Fine-tune
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Fine-tuning Jobs">
        <Table headers={['Dataset', 'Provider', 'Model', 'Status', 'Fine-tuned Model', '']} empty={!jobs.data?.length}>
          {jobs.data?.map((job) => (
            <tr key={job.id} className="text-slate-300">
              <td className="px-4 py-3">{job.dataset?.name ?? '-'}</td>
              <td className="px-4 py-3">{job.provider}</td>
              <td className="px-4 py-3">{job.baseModel}</td>
              <td className="px-4 py-3">{job.status}</td>
              <td className="px-4 py-3">{job.fineTunedModel ?? job.errorMessage ?? '-'}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => refreshJobMutation.mutate(job.id)}
                  className="text-indigo-400 hover:underline"
                  disabled={refreshJobMutation.isPending}
                >
                  Refresh
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal title="Edit Recording" open={Boolean(editRecording)} onClose={() => setEditRecording(null)}>
        <form onSubmit={handleEdit} className="space-y-4">
          {editError && <ErrorState message={editError} />}
          <Select
            label="Language"
            name="language"
            defaultValue={editRecording?.language ?? ''}
          >
            {TRAINING_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value || 'auto'} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Input
            label="Outcome"
            name="labelOutcome"
            defaultValue={editRecording?.labelOutcome ?? ''}
          />
          <Textarea
            label="Transcript"
            name="transcript"
            rows={6}
            defaultValue={editRecording?.transcript ?? ''}
          />
          <Textarea
            label="Redacted Transcript"
            name="redactedTranscript"
            rows={6}
            defaultValue={editRecording?.redactedTranscript ?? ''}
          />
          <Textarea
            label="Expected Model Response"
            name="expectedResponse"
            rows={5}
            defaultValue={editRecording?.expectedResponse ?? ''}
          />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" name="resetTranscription" className="rounded border-slate-600" />
            Reset transcription and allow re-transcribe
          </label>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </form>
      </Modal>

      <Modal
        title="Call Analysis"
        open={Boolean(viewAnalysis)}
        onClose={() => setViewAnalysis(null)}
        wide
      >
        {viewAnalysis && (
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-2">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs uppercase text-slate-500">Outcome</div>
                <div className="text-white">{viewAnalysis.outcome ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Lead Quality</div>
                <div className="text-white">{viewAnalysis.leadQuality ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Executive Score</div>
                <div className="text-white">{viewAnalysis.executiveScore ?? '—'}/100</div>
              </div>
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Summary</div>
              <p className="text-sm text-slate-300">{viewAnalysis.summary ?? '—'}</p>
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Customer Intent</div>
              <p className="text-sm text-slate-300">{viewAnalysis.customerIntent ?? '—'}</p>
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Next Action</div>
              <p className="text-sm text-slate-300">{viewAnalysis.nextAction ?? '—'}</p>
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Requirements</div>
              {stringList(viewAnalysis.customerRequirementsJson)}
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Objections</div>
              {stringList(viewAnalysis.objectionsJson)}
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Customer Questions</div>
              {stringList(viewAnalysis.customerQuestionsJson)}
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Important Details</div>
              {stringList(viewAnalysis.importantDetailsJson)}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-slate-500">Strengths</div>
                {stringList(viewAnalysis.executiveStrengthsJson)}
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Improvements</div>
                {stringList(viewAnalysis.executiveImprovementsJson)}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Missed Opportunities</div>
              {stringList(viewAnalysis.missedOpportunitiesJson)}
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Winning Phrases</div>
              {stringList(viewAnalysis.winningPhrasesJson)}
            </div>

            <div>
              <div className="text-xs uppercase text-slate-500">Phrases to Avoid</div>
              {stringList(viewAnalysis.badPhrasesJson)}
            </div>

            {viewAnalysis.confidence != null && (
              <div className="text-xs text-slate-500">
                Confidence: {(viewAnalysis.confidence * 100).toFixed(0)}%
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal title="Approve Training Example" open={Boolean(approveRecording)} onClose={() => setApproveRecording(null)}>
        <form onSubmit={handleApprove} className="space-y-4">
          {approveError && <ErrorState message={approveError} />}
          <Input label="Outcome Label" name="labelOutcome" defaultValue={approveRecording?.labelOutcome ?? ''} required />
          <Textarea
            label="Reviewed Transcript"
            name="redactedTranscript"
            rows={7}
            defaultValue={approveRecording?.redactedTranscript ?? approveRecording?.transcript ?? ''}
          />
          <Textarea
            label="Expected Model Response"
            name="expectedResponse"
            rows={5}
            required
            defaultValue={approveRecording?.expectedResponse ?? ''}
            placeholder="Customer was interested but needed pricing clarity. The ideal agent should acknowledge the concern, summarize the offer, and schedule a follow-up."
          />
          <Button type="submit" disabled={approveMutation.isPending}>
            {approveMutation.isPending ? 'Approving...' : 'Approve Example'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
