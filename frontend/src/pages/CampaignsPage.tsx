import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Textarea } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';
import { PaginatedResponse } from '../types';

interface Campaign {
  id: string;
  name: string;
  status: string;
  _count: { customers: number; calls: number };
}

export function CampaignsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Campaign>>('/campaigns');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api.post('/campaigns', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setShowCreate(false);
      setFormError('');
    },
    onError: () => setFormError('Failed to create campaign'),
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get('name') as string,
      description: (fd.get('description') as string) || undefined,
    });
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load campaigns" />;

  return (
    <div>
      <Card
        title="Campaigns"
        action={<Button onClick={() => setShowCreate(true)}>Create Campaign</Button>}
      >
        <Table headers={['Name', 'Status', 'Customers', 'Calls', '']} empty={!data?.data.length}>
          {data?.data.map((c) => (
            <tr key={c.id} className="text-slate-300">
              <td className="px-4 py-3">{c.name}</td>
              <td className="px-4 py-3 capitalize">{c.status}</td>
              <td className="px-4 py-3">{c._count.customers}</td>
              <td className="px-4 py-3">{c._count.calls}</td>
              <td className="px-4 py-3">
                <Link to={`/campaigns/${c.id}`} className="text-indigo-400 hover:underline">View</Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal title="Create Campaign" open={showCreate} onClose={() => setShowCreate(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <ErrorState message={formError} />}
          <Input label="Campaign Name" name="name" required />
          <Textarea label="Description" name="description" />
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
