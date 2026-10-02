import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDuplicate, useQuestions, useSetEnabled, type QuestionFilters } from '../api/questions';
import { ErrorMessage } from '../components/ErrorMessage';

export function QuestionListPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<QuestionFilters>({});
  const questions = useQuestions(filters);
  const setEnabled = useSetEnabled();
  const duplicate = useDuplicate();

  /** Applies a filter change; empty values remove the filter. */
  const update = (patch: { [K in keyof QuestionFilters]?: QuestionFilters[K] | undefined }) => {
    const merged = { ...filters, ...patch };
    setFilters(
      Object.fromEntries(
        Object.entries(merged).filter(([, v]) => v !== undefined && v !== ''),
      ) as QuestionFilters,
    );
  };

  return (
    <div className="stack">
      <div className="row">
        <h1>Questions</h1>
        <span className="spacer" />
        <Link to="/questions/new">
          <button className="primary">New question</button>
        </Link>
      </div>

      <div className="row card" role="search">
        <label>
          Search
          <input
            placeholder="title or slug"
            value={filters.q ?? ''}
            onChange={(e) => update({ q: e.target.value })}
          />
        </label>
        <label>
          Tier
          <select
            aria-label="Tier filter"
            value={filters.tier ?? ''}
            onChange={(e) => update({ tier: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">All</option>
            {[1, 2, 3, 4, 5].map((t) => (
              <option key={t} value={t}>
                Tier {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Status filter"
            value={filters.enabled === undefined ? '' : String(filters.enabled)}
            onChange={(e) =>
              update({ enabled: e.target.value === '' ? undefined : e.target.value === 'true' })
            }
          >
            <option value="">All</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>
          Topic
          <input
            placeholder="e.g. joins"
            value={filters.topic ?? ''}
            onChange={(e) => update({ topic: e.target.value.trim() })}
          />
        </label>
      </div>

      <ErrorMessage error={questions.error ?? setEnabled.error ?? duplicate.error} />

      {questions.isPending ? (
        <p className="muted">Loading…</p>
      ) : questions.data && questions.data.length === 0 ? (
        <p className="muted">No questions match. Create one or import a file.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Tier</th>
                <th>Topics</th>
                <th>Status</th>
                <th>Version</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {questions.data?.map((q) => (
                <tr
                  key={q.id}
                  className="clickable"
                  onClick={() => void navigate(`/questions/${q.id}`)}
                >
                  <td>{q.title}</td>
                  <td>
                    <code>{q.slug}</code>
                  </td>
                  <td className="num">{q.tier}</td>
                  <td>{q.topics.join(', ')}</td>
                  <td>
                    <span className={`badge ${q.enabled ? 'ok' : 'off'}`}>
                      {q.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                  <td className="num">v{q.version}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row">
                      <button
                        disabled={setEnabled.isPending}
                        onClick={() => setEnabled.mutate({ id: q.id, enabled: !q.enabled })}
                      >
                        {q.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        disabled={duplicate.isPending}
                        onClick={() =>
                          duplicate.mutate(q.id, {
                            onSuccess: (copy) => void navigate(`/questions/${copy?.id}`),
                          })
                        }
                      >
                        Duplicate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
