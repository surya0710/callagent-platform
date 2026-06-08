import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Modal, Select } from '../components/ui/Modal';
import { ErrorState, LoadingState, Table } from '../components/ui/Table';
import { PaginatedResponse } from '../types';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: Array<{ role: { name: string } }>;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<User>>('/users');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/users', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setFormError('');
    },
    onError: () => setFormError('Failed to create user'),
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      email: fd.get('email') as string,
      password: fd.get('password') as string,
      firstName: fd.get('firstName') as string,
      lastName: fd.get('lastName') as string,
      role: fd.get('role') as string,
    });
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load users" />;

  return (
    <div>
      <Card
        title="Users"
        action={<Button onClick={() => setShowCreate(true)}>Add User</Button>}
      >
        <Table headers={['Name', 'Email', 'Role', 'Status']} empty={!data?.data.length}>
          {data?.data.map((u) => (
            <tr key={u.id} className="text-slate-300">
              <td className="px-4 py-3">{u.firstName} {u.lastName}</td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3 capitalize">{u.roles[0]?.role.name ?? '—'}</td>
              <td className="px-4 py-3 capitalize">{u.status}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal title="Add User" open={showCreate} onClose={() => setShowCreate(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <ErrorState message={formError} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First Name" name="firstName" required />
            <Input label="Last Name" name="lastName" required />
          </div>
          <Input label="Email" name="email" type="email" required />
          <Input label="Password" name="password" type="password" required minLength={8} />
          <Select label="Role" name="role" defaultValue="agent">
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="agent">Agent</option>
          </Select>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create User'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
