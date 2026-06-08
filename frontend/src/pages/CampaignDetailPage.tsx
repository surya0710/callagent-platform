import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { ErrorState, LoadingState } from '../components/ui/Table';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showAddCustomers, setShowAddCustomers] = useState(false);
  const [actionError, setActionError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign', id],
    queryFn: async () => (await api.get(`/campaigns/${id}`)).data,
    enabled: !!id,
  });

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers')).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['calls'] });
  };

  const actionMutation = useMutation({
    mutationFn: async (action: string) => {
      if (action === 'schedule') return api.post(`/campaigns/${id}/schedule`, {});
      if (action === 'pause') return api.post(`/campaigns/${id}/pause`, {});
      if (action === 'resume') return api.post(`/campaigns/${id}/resume`, {});
      if (action === 'retry') return api.post(`/campaigns/${id}/retry-failed`, {});
    },
    onSuccess: invalidate,
    onError: () => setActionError('Action failed'),
  });

  const addCustomersMutation = useMutation({
    mutationFn: (customerIds: string[]) =>
      api.post(`/campaigns/${id}/customers`, { customerIds }),
    onSuccess: () => {
      invalidate();
      setShowAddCustomers(false);
    },
    onError: () => setActionError('Failed to add customers'),
  });

  const handleAddCustomers = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ids = fd.getAll('customerIds') as string[];
    if (ids.length) addCustomersMutation.mutate(ids);
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Campaign not found" />;

  const campaignCustomerIds = new Set(
    data.customers?.map((cc: { customerId: string }) => cc.customerId) ?? [],
  );
  const availableCustomers =
    customers?.data?.filter((c: { id: string }) => !campaignCustomerIds.has(c.id)) ?? [];

  return (
    <div className="space-y-6">
      <Link to="/campaigns" className="text-sm text-indigo-400 hover:underline">← Back to campaigns</Link>

      {actionError && <ErrorState message={actionError} />}

      <Card
        title={data.name}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShowAddCustomers(true)}>Add Customers</Button>
            {['draft', 'paused'].includes(data.status) && (
              <Button onClick={() => actionMutation.mutate('schedule')}>Schedule</Button>
            )}
            {['scheduled', 'running'].includes(data.status) && (
              <Button variant="secondary" onClick={() => actionMutation.mutate('pause')}>Pause</Button>
            )}
            {data.status === 'paused' && (
              <Button onClick={() => actionMutation.mutate('resume')}>Resume</Button>
            )}
            <Button variant="secondary" onClick={() => actionMutation.mutate('retry')}>Retry Failed</Button>
          </div>
        }
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Status</dt><dd className="capitalize">{data.status}</dd></div>
          <div><dt className="text-slate-500">Customers</dt><dd>{data.customers?.length ?? 0}</dd></div>
          <div><dt className="text-slate-500">Total Calls</dt><dd>{data._count?.calls ?? 0}</dd></div>
          <div><dt className="text-slate-500">Agent Prompt</dt><dd>{data.agentPrompt?.name ?? 'Default'}</dd></div>
        </dl>
        {data.description && <p className="mt-4 text-sm text-slate-400">{data.description}</p>}
      </Card>

      {data.customers?.length > 0 && (
        <Card title="Campaign Customers">
          <ul className="space-y-2 text-sm text-slate-300">
            {data.customers.map((cc: { customer: { id: string; firstName: string; lastName: string; phone: string } }) => (
              <li key={cc.customer.id}>
                {cc.customer.firstName} {cc.customer.lastName} — {cc.customer.phone}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal title="Add Customers" open={showAddCustomers} onClose={() => setShowAddCustomers(false)}>
        <form onSubmit={handleAddCustomers} className="space-y-4">
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {availableCustomers.map((c: { id: string; firstName: string; lastName: string; phone: string }) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="customerIds" value={c.id} className="rounded" />
                {c.firstName} {c.lastName} ({c.phone})
              </label>
            ))}
            {!availableCustomers.length && (
              <p className="text-sm text-slate-500">No available customers to add.</p>
            )}
          </div>
          <Button type="submit" disabled={addCustomersMutation.isPending || !availableCustomers.length}>
            Add Selected
          </Button>
        </form>
      </Modal>
    </div>
  );
}
