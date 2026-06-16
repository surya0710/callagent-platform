import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import api from '../lib/api';
import { canManageUsers } from '../lib/auth-utils';
import { useAuthStore } from '../stores/authStore';
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

type UserFormBody = {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  password?: string;
};

export function UsersPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const canEdit = canManageUsers(currentUser);

  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formError, setFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<User>>('/users');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: UserFormBody) => api.post('/users', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setFormError('');
    },
    onError: () => setFormError('Failed to create user'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UserFormBody> }) =>
      api.patch(`/users/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      setFormError('');
    },
    onError: () => setFormError('Failed to update user'),
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

  const handleUpdate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUser) return;

    const fd = new FormData(e.currentTarget);
    const password = (fd.get('password') as string).trim();
    const body: Partial<UserFormBody> = {
      email: fd.get('email') as string,
      firstName: fd.get('firstName') as string,
      lastName: fd.get('lastName') as string,
      role: fd.get('role') as string,
    };

    if (password.length > 0) {
      body.password = password;
    }

    updateMutation.mutate({ id: editingUser.id, body });
  };

  const closeModals = () => {
    setShowCreate(false);
    setEditingUser(null);
    setFormError('');
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load users" />;

  const tableHeaders = canEdit
    ? ['Name', 'Email', 'Role', 'Status', 'Actions']
    : ['Name', 'Email', 'Role', 'Status'];

  return (
    <div>
      <Card
        title="Users"
        action={
          canEdit ? (
            <Button onClick={() => setShowCreate(true)}>Add User</Button>
          ) : undefined
        }
      >
        <Table headers={tableHeaders} empty={!data?.data.length}>
          {data?.data.map((u) => (
            <tr key={u.id} className="text-slate-300">
              <td className="px-4 py-3">
                {u.firstName} {u.lastName}
              </td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3 capitalize">{u.roles[0]?.role.name ?? '—'}</td>
              <td className="px-4 py-3 capitalize">{u.status}</td>
              {canEdit && (
                <td className="px-4 py-3">
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => {
                      setFormError('');
                      setEditingUser(u);
                    }}
                  >
                    Edit
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      </Card>

      <Modal title="Add User" open={showCreate} onClose={closeModals}>
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

      <Modal
        title="Edit User"
        open={editingUser !== null}
        onClose={closeModals}
      >
        {editingUser && (
          <form
            key={editingUser.id}
            onSubmit={handleUpdate}
            className="space-y-4"
          >
            {formError && <ErrorState message={formError} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="First Name"
                name="firstName"
                defaultValue={editingUser.firstName}
                required
              />
              <Input
                label="Last Name"
                name="lastName"
                defaultValue={editingUser.lastName}
                required
              />
            </div>
            <Input
              label="Email"
              name="email"
              type="email"
              defaultValue={editingUser.email}
              required
            />
            <Input
              label="New Password"
              name="password"
              type="password"
              minLength={8}
              placeholder="Leave blank to keep current password"
            />
            <p className="text-xs text-slate-500">
              Only fill in the password field if you want to change it (minimum 8
              characters).
            </p>
            <Select
              label="Role"
              name="role"
              defaultValue={editingUser.roles[0]?.role.name ?? 'agent'}
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="agent">Agent</option>
            </Select>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
