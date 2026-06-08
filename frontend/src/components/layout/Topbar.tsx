import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export function Topbar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 py-4">
      <div>
        <p className="text-sm text-slate-400">Signed in as</p>
        <p className="font-medium text-white">
          {user ? `${user.firstName} ${user.lastName}` : 'Unknown'}
        </p>
      </div>
      <button
        onClick={handleLogout}
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
      >
        Logout
      </button>
    </header>
  );
}
