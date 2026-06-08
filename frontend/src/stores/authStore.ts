import { create } from 'zustand';
import api from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

interface AuthState {
  user: AuthUser | null;
  isBootstrapped: boolean;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isBootstrapped: false,

  setUser: (user) => set({ user }),

  clearUser: () => set({ user: null }),

  bootstrap: async () => {
    // Remove legacy localStorage session from earlier versions
    localStorage.removeItem('ai-voice-auth');

    try {
      const { data } = await api.get<AuthUser>('/auth/me');
      set({ user: data, isBootstrapped: true });
    } catch {
      set({ user: null, isBootstrapped: true });
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      set({ user: null });
    }
  },
}));
