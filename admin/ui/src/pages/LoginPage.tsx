import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminUser } from '@heist/shared';
import { api } from '../api/client';
import { meQueryKey } from '../auth/useMe';
import { ErrorMessage } from '../components/ErrorMessage';

export function LoginPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: AdminUser }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      queryClient.setQueryData(meQueryKey, user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>SQL Heist City</h1>
        <p className="muted">Teacher &amp; admin console</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorMessage error={error} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
