import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Select } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

type WebhookAuthType = 'none' | 'bearer' | 'header';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  webhookUrl: string | null;
  webhookAuthType: WebhookAuthType;
  webhookAuthHeaderName: string | null;
  hasWebhookAuthToken: boolean;
  isActive: boolean;
  _count: { calls: number };
}

interface ApiKeyFormValues {
  name: string;
  webhookUrl: string;
  webhookAuthType: WebhookAuthType;
  webhookAuthHeaderName: string;
  webhookAuthToken: string;
  clearWebhookAuthToken: boolean;
}

const emptyForm: ApiKeyFormValues = {
  name: '',
  webhookUrl: '',
  webhookAuthType: 'none',
  webhookAuthHeaderName: 'X-API-Key',
  webhookAuthToken: '',
  clearWebhookAuthToken: false,
};

function authTypeLabel(type: WebhookAuthType, headerName: string | null, hasToken: boolean) {
  if (type === 'bearer') {
    return hasToken ? 'Bearer token' : 'Bearer (not set)';
  }
  if (type === 'header') {
    return hasToken ? `${headerName ?? 'X-API-Key'} header` : `${headerName ?? 'X-API-Key'} (not set)`;
  }
  return 'None';
}

function WebhookAuthFields({
  authType,
  initial,
  showClearToken,
}: {
  authType: WebhookAuthType;
  initial: ApiKeyFormValues;
  showClearToken?: boolean;
}) {
  return (
    <>
      <Select
        label="Webhook authentication"
        name="webhookAuthType"
        defaultValue={initial.webhookAuthType}
      >
        <option value="none">None</option>
        <option value="bearer">Bearer token</option>
        <option value="header">Custom header</option>
      </Select>

      {authType === 'header' && (
        <Input
          label="Header name"
          name="webhookAuthHeaderName"
          defaultValue={initial.webhookAuthHeaderName}
          placeholder="X-API-Key"
        />
      )}

      {(authType === 'bearer' || authType === 'header') && (
        <>
          <Input
            label={authType === 'bearer' ? 'Bearer token' : 'Header value'}
            name="webhookAuthToken"
            type="password"
            autoComplete="new-password"
            placeholder={showClearToken ? 'Leave blank to keep existing' : 'Secret sent to your webhook URL'}
          />
          {showClearToken && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="clearWebhookAuthToken" className="rounded border-slate-600" />
              Remove stored webhook auth token
            </label>
          )}
        </>
      )}
    </>
  );
}

function ApiKeyFormModal({
  title,
  open,
  onClose,
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  initial: ApiKeyFormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: ApiKeyFormValues) => void;
}) {
  const [authType, setAuthType] = useState<WebhookAuthType>(initial.webhookAuthType);

  useEffect(() => {
    if (open) {
      setAuthType(initial.webhookAuthType);
    }
  }, [open, initial.webhookAuthType]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      name: (fd.get('name') as string).trim(),
      webhookUrl: (fd.get('webhookUrl') as string).trim(),
      webhookAuthType: (fd.get('webhookAuthType') as WebhookAuthType) || 'none',
      webhookAuthHeaderName: (fd.get('webhookAuthHeaderName') as string)?.trim() || 'X-API-Key',
      webhookAuthToken: (fd.get('webhookAuthToken') as string)?.trim() || '',
      clearWebhookAuthToken: fd.get('clearWebhookAuthToken') === 'on',
    });
  };

  return (
    <Modal title={title} open={open} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4" key={open ? initial.name : 'closed'}>
        <Input
          label="Application / client name"
          name="name"
          required
          defaultValue={initial.name}
          placeholder="Driver Service Production"
        />
        <Input
          label="Webhook URL"
          name="webhookUrl"
          type="url"
          defaultValue={initial.webhookUrl}
          placeholder="https://your-platform.com/webhooks/voice"
        />
        <p className="text-xs text-slate-500">
          We POST call status, recording download URL, and transcript to this URL. Events are sent
          with header <code className="text-indigo-300">X-AI-Voice-Event</code>.
        </p>

        <div
          onChange={(event) => {
            const target = event.target;
            if (target instanceof HTMLSelectElement && target.name === 'webhookAuthType') {
              setAuthType(target.value as WebhookAuthType);
            }
          }}
        >
          <WebhookAuthFields
            authType={authType}
            initial={initial}
            showClearToken={Boolean(initial.name)}
          />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : submitLabel}
        </Button>
      </form>
    </Modal>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editKey, setEditKey] = useState<ApiKeyRow | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await api.get<ApiKeyRow[]>('/integrations/api-keys');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/integrations/api-keys', payload),
    onSuccess: (res) => {
      setNewKey(res.data.apiKey);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/integrations/api-keys/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setEditKey(null);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/integrations/api-keys/${id}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const buildPayload = (values: ApiKeyFormValues, mode: 'create' | 'update') => {
    const payload: Record<string, unknown> = {
      name: values.name,
      webhookUrl: values.webhookUrl || undefined,
      webhookAuthType: values.webhookAuthType,
    };

    if (values.webhookAuthType === 'header') {
      payload.webhookAuthHeaderName = values.webhookAuthHeaderName || 'X-API-Key';
    }

    if (values.webhookAuthToken) {
      payload.webhookAuthToken = values.webhookAuthToken;
    }

    if (mode === 'update') {
      payload.clearWebhookAuthToken = values.clearWebhookAuthToken;
    }

    return payload;
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
          Create credentials for external apps. Each key includes a webhook URL and optional outbound
          auth (Bearer or custom header) used when we deliver call status, recordings, and transcripts.
          Partners call <code className="text-indigo-300">POST /api/integrations/v1/calls</code> with{' '}
          <code className="text-indigo-300">X-API-Key</code>.
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
          <Table
            headers={['Application', 'Prefix', 'Webhook URL', 'Webhook auth', 'Calls', 'Status', '']}
            empty={!data?.length}
          >
            {data?.map((k) => (
              <tr key={k.id} className="text-slate-300">
                <td className="px-4 py-3">{k.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{k.keyPrefix}...</td>
                <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-400">
                  {k.webhookUrl ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {authTypeLabel(k.webhookAuthType, k.webhookAuthHeaderName, k.hasWebhookAuthToken)}
                </td>
                <td className="px-4 py-3">{k._count.calls}</td>
                <td className="px-4 py-3">{k.isActive ? 'Active' : 'Revoked'}</td>
                <td className="space-x-3 px-4 py-3">
                  {k.isActive && (
                    <>
                      <button
                        onClick={() => setEditKey(k)}
                        className="text-indigo-300 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => revokeMutation.mutate(k.id)}
                        className="text-red-400 hover:underline"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ApiKeyFormModal
        title="Create Integration API Key"
        open={showCreate}
        onClose={() => setShowCreate(false)}
        initial={emptyForm}
        submitLabel="Generate Key"
        pending={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate(buildPayload(values, 'create'))}
      />

      <ApiKeyFormModal
        title="Edit Integration API Key"
        open={Boolean(editKey)}
        onClose={() => setEditKey(null)}
        initial={
          editKey
            ? {
                name: editKey.name,
                webhookUrl: editKey.webhookUrl ?? '',
                webhookAuthType: editKey.webhookAuthType,
                webhookAuthHeaderName: editKey.webhookAuthHeaderName ?? 'X-API-Key',
                webhookAuthToken: '',
                clearWebhookAuthToken: false,
              }
            : emptyForm
        }
        submitLabel="Save Changes"
        pending={updateMutation.isPending}
        onSubmit={(values) => {
          if (!editKey) return;
          updateMutation.mutate({
            id: editKey.id,
            payload: buildPayload(values, 'update'),
          });
        }}
      />
    </div>
  );
}
