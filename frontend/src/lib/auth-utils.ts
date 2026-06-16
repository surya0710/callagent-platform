import { AuthUser } from '../stores/authStore';

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return user?.roles.includes('admin') ?? false;
}

export function canManageUsers(user: AuthUser | null | undefined): boolean {
  return user?.permissions.includes('users.write') ?? false;
}
