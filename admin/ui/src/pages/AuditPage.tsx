import { useState } from 'react';
import { useAudit } from '../api/admin';
import { ErrorMessage } from '../components/ErrorMessage';

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const [pages, setPages] = useState<(number | undefined)[]>([undefined]);
  const before = pages[pages.length - 1];
  const audit = useAudit(entity, before);
  const entries = audit.data ?? [];

  return (
    <div className="stack">
      <h1>Audit log</h1>
      <div className="row">
        <label>
          Show
          <select
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setPages([undefined]);
            }}
          >
            <option value="">Everything</option>
            <option value="question">Questions</option>
            <option value="pool">Pools</option>
            <option value="settings">Settings</option>
            <option value="user">Users</option>
          </select>
        </label>
      </div>
      <ErrorMessage error={audit.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.at).toLocaleString()}</td>
                <td>{e.actor ?? '—'}</td>
                <td>
                  {e.action} {e.entity} {e.entityId && <code>#{e.entityId}</code>}
                </td>
                <td>
                  <code>{e.detail ? JSON.stringify(e.detail) : ''}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button disabled={pages.length === 1} onClick={() => setPages(pages.slice(0, -1))}>
          Newer
        </button>
        <button
          disabled={entries.length < 50}
          onClick={() => setPages([...pages, entries[entries.length - 1]?.id])}
        >
          Older
        </button>
      </div>
    </div>
  );
}
