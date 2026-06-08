import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { LoadingState } from '../ui/Table';

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const isBootstrapped = useAuthStore((s) => s.isBootstrapped);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (!isBootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <LoadingState />
      </div>
    );
  }

  return <>{children}</>;
}
