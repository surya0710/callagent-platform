import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();

  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await api.get(`/customers/${id}`)).data,
    enabled: !!id,
  });

  const calls = useQuery({
    queryKey: ['customer-calls', id],
    queryFn: async () => (await api.get(`/customers/${id}/calls`)).data,
    enabled: !!id,
  });

  if (customer.isLoading) return <LoadingState />;
  if (customer.error) return <ErrorState message="Customer not found" />;

  const c = customer.data;

  return (
    <div className="space-y-6">
      <Link to="/customers" className="text-sm text-indigo-400 hover:underline">← Back to customers</Link>
      <Card title={`${c.firstName} ${c.lastName}`}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Phone</dt><dd>{c.phone}</dd></div>
          <div><dt className="text-slate-500">Email</dt><dd>{c.email ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Language</dt><dd>{c.language}</dd></div>
          <div><dt className="text-slate-500">Status</dt><dd className="capitalize">{c.status}</dd></div>
        </dl>
      </Card>
      <Card title="Call History">
        {calls.isLoading ? <LoadingState /> : (
          <Table headers={['Status', 'Phone', 'Campaign', 'Date']} empty={!calls.data?.length}>
            {calls.data?.map((call: { id: string; status: string; phone: string; campaign?: { name: string }; createdAt: string }) => (
              <tr key={call.id} className="text-slate-300">
                <td className="px-4 py-3 capitalize">{call.status}</td>
                <td className="px-4 py-3">{call.phone}</td>
                <td className="px-4 py-3">{call.campaign?.name ?? '—'}</td>
                <td className="px-4 py-3">{new Date(call.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
