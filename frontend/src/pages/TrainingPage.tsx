import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Textarea } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

interface TrainingRecording {
  id: string;
  originalFileName: string;
  status: string;
  labelOutcome?: string;
  transcript?: string;
  redactedTranscript?: string;
  trainingApproved: boolean;
  createdAt: string;
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
  const [uploadError, setUploadError] = useState('');
  const [approveError, setApproveError] = useState('');
  const [datasetError, setDatasetError] = useState('');

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

  const invalidateTraining = () => {
    queryClient.invalidateQueries({ queryKey: ['training-recordings'] });
    queryClient.invalidateQueries({ queryKey: ['training-datasets'] });
    queryClient.invalidateQueries({ queryKey: ['training-jobs'] });
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
    onSuccess: invalidateTraining,
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

  const handleUpload = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    uploadMutation.mutate(fd);
    e.currentTarget.reset();
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
      <Card title="Training Upload">
        <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-[1fr_160px_160px_auto]">
          {uploadError && <div className="md:col-span-4"><ErrorState message={uploadError} /></div>}
          <Input label="Recording" name="file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4" required />
          <Input label="Language" name="language" placeholder="en" />
          <Input label="Outcome" name="labelOutcome" placeholder="interested" />
          <div className="flex items-end">
            <Button type="submit" disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Recordings">
        <Table headers={['File', 'Status', 'Outcome', 'Approved', 'Actions']} empty={!recordings.data?.length}>
          {recordings.data?.map((recording) => (
            <tr key={recording.id} className="text-slate-300">
              <td className="px-4 py-3">{recording.originalFileName}</td>
              <td className="px-4 py-3">{recording.status}</td>
              <td className="px-4 py-3">{recording.labelOutcome ?? '-'}</td>
              <td className="px-4 py-3">{recording.trainingApproved ? 'Yes' : 'No'}</td>
              <td className="space-x-3 px-4 py-3">
                <button
                  onClick={() => transcribeMutation.mutate(recording.id)}
                  className="text-indigo-400 hover:underline"
                  disabled={transcribeMutation.isPending}
                >
                  Transcribe
                </button>
                <button
                  onClick={() => setApproveRecording(recording)}
                  className="text-indigo-400 hover:underline"
                >
                  Approve
                </button>
              </td>
            </tr>
          ))}
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
