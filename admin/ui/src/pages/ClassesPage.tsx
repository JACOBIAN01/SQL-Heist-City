import { useState } from 'react';
import { Link } from 'react-router';
import { useArchiveClass, useClasses, useCreateClass } from '../api/classes';
import { ErrorMessage } from '../components/ErrorMessage';

/** A teacher's classes: the join code, and a way in to each one. */
export function ClassesPage() {
  const classes = useClasses();
  const create = useCreateClass();
  const archive = useArchiveClass();
  const [name, setName] = useState('');

  return (
    <div className="stack">
      <h1>Classes</h1>
      <p className="muted">
        A class is a room your students join with its code. You choose which banks are open and
        which questions they get. Students sign in with Google, type the code, and land in the same
        city.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
        }}
      >
        <input
          aria-label="New class name"
          placeholder="Class name, e.g. 9B SQL"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <button className="primary" disabled={create.isPending || !name.trim()}>
          Create class
        </button>
      </form>
      <ErrorMessage error={classes.error ?? create.error ?? archive.error} />
      <div className="card">
        {classes.data?.length === 0 && <p className="muted">No classes yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Join code</th>
              <th>Banks open</th>
              <th>Up to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {classes.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/classes/${c.id}`}>{c.name}</Link>
                </td>
                <td>
                  <code className="join-code">{c.code}</code>
                </td>
                <td>{c.banksOpen.length === 5 ? 'all' : c.banksOpen.join(', ') || 'none'}</td>
                <td className="num">{c.playerCap}</td>
                <td>
                  <button
                    className="danger"
                    onClick={() =>
                      window.confirm(`Archive "${c.name}"? Students can no longer join it.`) &&
                      archive.mutate(c.id)
                    }
                  >
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
