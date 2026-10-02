import { NavLink, Outlet } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminUser } from '@heist/shared';
import { api } from '../api/client';
import { meQueryKey } from '../auth/useMe';
import { ThemeToggle } from '../theme/ThemeToggle';

export function Shell({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const isAdmin = user.role === 'admin';

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    queryClient.setQueryData(meQueryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">SQL Heist City · Admin</span>
        <nav>
          <NavLink to="/questions">Questions</NavLink>
          <NavLink to="/pools">Pools</NavLink>
          <NavLink to="/import-export">Import / Export</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {isAdmin && <NavLink to="/audit">Audit log</NavLink>}
          {isAdmin && <NavLink to="/users">Users</NavLink>}
        </nav>
        <ThemeToggle />
        <span className="who">
          {user.email} <span className="badge">{user.role}</span>
          <button className="link" onClick={() => void logout()}>
            Sign out
          </button>
        </span>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
