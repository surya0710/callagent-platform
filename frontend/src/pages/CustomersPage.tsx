import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Textarea } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';
import { PaginatedResponse } from '../types';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  status: string;
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Customer>>('/customers');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/customers', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowCreate(false);
      setFormError('');
    },
    onError: () => setFormError('Failed to create customer'),
  });

  const importMutation = useMutation({
    mutationFn: (csv: string) => api.post('/customers/import', { csv }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowImport(false);
      setFormError('');
    },
    onError: () => setFormError('Failed to import customers'),
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      firstName: fd.get('firstName') as string,
      lastName: fd.get('lastName') as string,
      phone: fd.get('phone') as string,
      email: fd.get('email') as string,
    });
  };

  const handleImport = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    importMutation.mutate(fd.get('csv') as string);
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load customers" />;

  return (
    <div>
      <Card
        title="Customers"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowImport(true)}>Import CSV</Button>
            <Button onClick={() => setShowCreate(true)}>Add Customer</Button>
          </div>
        }
      >
        <Table headers={['Name', 'Phone', 'Email', 'Status', '']} empty={!data?.data.length}>
          {data?.data.map((c) => (
            <tr key={c.id} className="text-slate-300">
              <td className="px-4 py-3">{c.firstName} {c.lastName}</td>
              <td className="px-4 py-3">{c.phone}</td>
              <td className="px-4 py-3">{c.email ?? '—'}</td>
              <td className="px-4 py-3 capitalize">{c.status}</td>
              <td className="px-4 py-3">
                <Link to={`/customers/${c.id}`} className="text-indigo-400 hover:underline">View</Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal title="Add Customer" open={showCreate} onClose={() => setShowCreate(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <ErrorState message={formError} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First Name" name="firstName" required />
            <Input label="Last Name" name="lastName" required />
          </div>
          <Input label="Phone" name="phone" required placeholder="+15551234567" />
          <Input label="Email" name="email" type="email" />
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Create Customer'}
          </Button>
        </form>
      </Modal>

      <Modal title="Import Customers" open={showImport} onClose={() => setShowImport(false)}>
        <form onSubmit={handleImport} className="space-y-4">
          {formError && <ErrorState message={formError} />}
          <Textarea
            label="CSV (firstName,lastName,phone,email)"
            name="csv"
            required
            placeholder="firstName,lastName,phone,email&#10;John,Doe,+15551234567,john@example.com"
          />
          <Button type="submit" disabled={importMutation.isPending}>
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
