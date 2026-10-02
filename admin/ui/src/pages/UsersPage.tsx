import { useState, type FormEvent } from 'react';
import type { Role } from '@heist/shared';
import { useCreateUser, useUpdateUser, useUsers } from '../api/admin';
import { useMe } from '../auth/useMe';
import { ErrorMessage } from '../components/ErrorMessage';

export function UsersPage() {
  const me = useMe();
  const users = useUsers();
  const create = useCreateUser();
  const update = useUpdateUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('teacher');

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { email, password, role },
      {
        onSuccess: () => {
          setEmail('');
          setPassword('');
        },
      },
    );
  }

  function resetPassword(id: number, who: string) {
    const pw = window.prompt(`New password for ${who} (at least 10 characters):`);
    if (pw) update.mutate({ id, password: pw });
  }

  return (
    <div className="stack">
      <h1>Users</h1>
      <form className="card row" onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Temporary password
          <input
            type="password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={create.isPending}>
          Add user
        </button>
      </form>
      <ErrorMessage error={users.error ?? create.error ?? update.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => {
              const self = u.id === me.data?.id;
              return (
                <tr key={u.id}>
                  <td>
                    {u.email} {self && <span className="badge">you</span>}
                  </td>
                  <td>
                    <select
                      aria-label={`Role of ${u.email}`}
                      value={u.role}
                      disabled={self}
                      onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })}
                    >
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.disabled ? 'off' : 'ok'}`}>
                      {u.disabled ? 'disabled' : 'active'}
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      <button
                        disabled={self}
                        onClick={() => update.mutate({ id: u.id, disabled: !u.disabled })}
                      >
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button onClick={() => resetPassword(u.id, u.email)}>Reset password</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
