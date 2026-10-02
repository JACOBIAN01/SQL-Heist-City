import { useState } from 'react';
import { useQuestionVersions, useRollback } from '../api/questions';
import { ErrorMessage } from '../components/ErrorMessage';
import { lineDiff } from './lineDiff';

/** Version history with a diff against the previous version and one-click rollback. */
export function VersionsPanel({ id }: { id: number }) {
  const versions = useQuestionVersions(id);
  const rollback = useRollback();
  const [selected, setSelected] = useState<number | null>(null);

  if (versions.isPending) return <p className="muted">Loading…</p>;
  if (versions.isError) return <ErrorMessage error={versions.error} />;
  const list = [...versions.data].reverse();
  const latest = list[0]?.version;
  const current = list.find((v) => v.version === (selected ?? latest));
  const previous = versions.data.find((v) => v.version === (current?.version ?? 0) - 1);
  const diff =
    current && previous
      ? lineDiff(
          JSON.stringify(previous.template, null, 2),
          JSON.stringify(current.template, null, 2),
        )
      : [];
  const changed = diff.filter((l) => l.kind !== 'same').length;

  return (
    <div className="grid-2">
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>By</th>
              <th>When</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr
                key={v.version}
                className="clickable"
                aria-selected={v.version === current?.version}
                onClick={() => setSelected(v.version)}
              >
                <td>
                  v{v.version} {v.version === latest && <span className="badge ok">current</span>}
                </td>
                <td>{v.createdBy ?? '—'}</td>
                <td>{new Date(v.createdAt).toLocaleString()}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {v.version !== latest && (
                    <button
                      disabled={rollback.isPending}
                      onClick={() => {
                        if (
                          window.confirm(`Restore v${v.version}? It is saved as a new version.`)
                        ) {
                          rollback.mutate({ id, version: v.version });
                        }
                      }}
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ErrorMessage error={rollback.error} />
      </div>
      <div className="card stack">
        <strong>
          {current ? `Changes in v${current.version}` : ''}
          {previous ? ` (vs v${previous.version}, ${changed} lines)` : ' (first version)'}
        </strong>
        {previous ? (
          <pre className="diff">
            {diff.map((l, i) =>
              l.kind === 'same' ? null : (
                <div key={i} className={l.kind}>
                  {l.kind === 'added' ? '+ ' : '- '}
                  {l.text}
                </div>
              ),
            )}
          </pre>
        ) : (
          <pre>{JSON.stringify(current?.template, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
