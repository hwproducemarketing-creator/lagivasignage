import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/content', label: 'Content' },
  { to: '/screens', label: 'Screens' },
  { to: '/promotions', label: 'Promotions' },
  { to: '/settings', label: 'Settings' },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-hw-gray">
      <header className="border-b border-hw-dark/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              Menu
            </button>
            <div>
              <div className="font-display text-xl font-bold tracking-wide text-hw-dark sm:text-2xl">
                H&W PRODUCE
              </div>
              <div className="text-xs font-medium uppercase tracking-wider text-hw-muted">
                Digital Signage
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-hw-muted sm:inline">{user?.username}</span>
            <button type="button" className="btn-secondary" onClick={() => logout()}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <aside
          className={`${
            open ? 'block' : 'hidden'
          } w-full shrink-0 lg:block lg:w-52`}
        >
          <nav className="card flex flex-col gap-1 p-3">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? 'bg-hw-light text-hw-dark'
                      : 'text-hw-muted hover:bg-gray-50 hover:text-hw-text'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
