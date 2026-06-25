import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  webhookUrl: string | null;
  isActive: boolean;
  _count: { calls: number };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await api.get<ApiKeyRow[]>('/integrations/api-keys');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; webhookUrl?: string }) =>
      api.post('/integrations/api-keys', payload),
    onSuccess: (res) => {
      setNewKey(res.data.apiKey);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setShowCreate(false);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/integrations/api-keys/${id}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name') as string;
    const webhookUrl = (fd.get('webhookUrl') as string)?.trim();
    createMutation.mutate({
      name,
      ...(webhookUrl ? { webhookUrl } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      <Card title="Platform Configuration">
        <p className="text-sm text-slate-400">
          AI provider: <code className="text-indigo-300">AI_PROVIDER</code> on the server.
          Auth uses httpOnly cookies for the admin dashboard.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">API Base URL</dt>
            <dd>{import.meta.env.VITE_API_BASE_URL || '/api'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Integration docs</dt>
            <dd>docs/integrations/EXTERNAL_API.md</dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Integration API Keys"
        action={<Button onClick={() => setShowCreate(true)}>Create API Key</Button>}
      >
        <p className="mb-4 text-sm text-slate-400">
          External apps (e.g. driver service) use these keys with the{' '}
          <code className="text-indigo-300">X-API-Key</code> header to request on-demand calls.
          Set a webhook URL to receive call status updates and post-call recording + transcript
          delivery.
        </p>

        {newKey && (
          <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
            <p className="font-medium">New API key — copy now, it won&apos;t be shown again:</p>
            <code className="mt-2 block break-all">{newKey}</code>
          </div>
        )}

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message="Failed to load API keys" />
        ) : (
          <Table headers={['Name', 'Prefix', 'Webhook', 'Calls', 'Status', '']} empty={!data?.length}>
            {data?.map((k) => (
              <tr key={k.id} className="text-slate-300">
                <td className="px-4 py-3">{k.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{k.keyPrefix}...</td>
                <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-400">
                  {k.webhookUrl ?? '—'}
                </td>
                <td className="px-4 py-3">{k._count.calls}</td>
                <td className="px-4 py-3">{k.isActive ? 'Active' : 'Revoked'}</td>
                <td className="px-4 py-3">
                  {k.isActive && (
                    <button
                      onClick={() => revokeMutation.mutate(k.id)}
                      className="text-red-400 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal title="Create Integration API Key" open={showCreate} onClose={() => setShowCreate(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Application Name" name="name" required placeholder="Driver Service Production" />
          <Input
            label="Webhook URL"
            name="webhookUrl"
            type="url"
            placeholder="https://your-driver-app.com/webhooks/voice"
          />
          <p className="text-xs text-slate-500">
            Receives <code>call.status_changed</code> during the call and{' '}
            <code>call.result_ready</code> after the call with recording download URL and transcript.
          </p>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Generate Key'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
