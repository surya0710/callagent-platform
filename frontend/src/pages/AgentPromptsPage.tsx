import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Textarea } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

interface AgentPrompt {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  isActive: boolean;
  version: number;
}

export function AgentPromptsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-prompts'],
    queryFn: async () => {
      const res = await api.get<AgentPrompt[]>('/agent-prompts');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string; systemPrompt: string }) =>
      api.post('/agent-prompts', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-prompts'] });
      setShowCreate(false);
      setFormError('');
    },
    onError: () => setFormError('Failed to create prompt'),
  });

  const activateMutation = useMutation({
    mutationFn: (promptId: string) => api.post(`/agent-prompts/${promptId}/activate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-prompts'] }),
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get('name') as string,
      description: (fd.get('description') as string) || undefined,
      systemPrompt: fd.get('systemPrompt') as string,
    });
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load agent prompts" />;

  return (
    <div>
      <Card
        title="Agent Prompts"
        action={<Button onClick={() => setShowCreate(true)}>New Prompt</Button>}
      >
        <Table headers={['Name', 'Version', 'Active', 'Description', '']} empty={!data?.length}>
          {data?.map((p) => (
            <tr key={p.id} className="text-slate-300">
              <td className="px-4 py-3">{p.name}</td>
              <td className="px-4 py-3">v{p.version}</td>
              <td className="px-4 py-3">{p.isActive ? 'Yes' : 'No'}</td>
              <td className="px-4 py-3">{p.description ?? '—'}</td>
              <td className="px-4 py-3">
                {!p.isActive && (
                  <button
                    onClick={() => activateMutation.mutate(p.id)}
                    className="text-indigo-400 hover:underline"
                  >
                    Activate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal title="New Agent Prompt" open={showCreate} onClose={() => setShowCreate(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <ErrorState message={formError} />}
          <Input label="Name" name="name" required />
          <Input label="Description" name="description" />
          <Textarea label="System Prompt" name="systemPrompt" required rows={6} />
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Create Prompt'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
