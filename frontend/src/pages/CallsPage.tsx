import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';
import { PaginatedResponse } from '../types';

interface Call {
  id: string;
  status: string;
  phone: string;
  source: string;
  externalRef?: string;
  callPurpose?: string;
  customer: { firstName: string; lastName: string };
  campaign?: { name: string };
  createdAt: string;
}

export function CallsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['calls'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Call>>('/calls');
      return res.data;
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load calls" />;

  return (
    <Card title="Calls">
      <Table headers={['Customer', 'Phone', 'Source', 'Ref / Purpose', 'Status', 'Date', '']} empty={!data?.data.length}>
        {data?.data.map((call) => (
          <tr key={call.id} className="text-slate-300">
            <td className="px-4 py-3">{call.customer.firstName} {call.customer.lastName}</td>
            <td className="px-4 py-3">{call.phone}</td>
            <td className="px-4 py-3 capitalize">{call.source}</td>
            <td className="px-4 py-3 text-xs">
              {call.externalRef ?? '—'}
              {call.callPurpose && <span className="block text-slate-500">{call.callPurpose}</span>}
            </td>
            <td className="px-4 py-3 capitalize">{call.status}</td>
            <td className="px-4 py-3">{new Date(call.createdAt).toLocaleString()}</td>
            <td className="px-4 py-3">
              <Link to={`/calls/${call.id}`} className="text-indigo-400 hover:underline">View</Link>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
