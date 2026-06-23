import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/calls', label: 'Calls' },
  { to: '/voice/sessions', label: 'Voice Sessions' },
  { to: '/voice/test-call', label: 'Initiate Call' },
  { to: '/agent-prompts', label: 'Agent Prompts' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/training', label: 'Training' },
  { to: '/training/call-analysis', label: 'Call Analysis' },
  { to: '/users', label: 'Users' },
  { to: '/settings', label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-900/80">
      <div className="border-b border-slate-800 px-6 py-5">
        <h1 className="text-lg font-bold text-indigo-400">AI Voice Platform</h1>
        <p className="text-xs text-slate-500">Outbound calling admin</p>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
