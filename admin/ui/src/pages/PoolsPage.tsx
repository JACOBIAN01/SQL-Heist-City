import { useState } from 'react';
import type { Pool } from '@heist/shared';
import { useDeletePool, usePools, useSavePool } from '../api/admin';
import { useQuestions } from '../api/questions';
import { ErrorMessage } from '../components/ErrorMessage';

interface PoolForm {
  id?: number;
  name: string;
  description: string;
  questionIds: number[];
}

const EMPTY: PoolForm = { name: '', description: '', questionIds: [] };

export function PoolsPage() {
  const pools = usePools();
  const questions = useQuestions({});
  const save = useSavePool();
  const remove = useDeletePool();
  const [form, setForm] = useState<PoolForm | null>(null);

  const edit = (p: Pool) =>
    setForm({
      id: p.id,
      name: p.name,
      description: p.description,
      questionIds: [...p.questionIds],
    });
  const toggle = (qid: number) =>
    form &&
    setForm({
      ...form,
      questionIds: form.questionIds.includes(qid)
        ? form.questionIds.filter((x) => x !== qid)
        : [...form.questionIds, qid],
    });

  return (
    <div className="stack">
      <div className="row">
        <h1>Question pools</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setForm(EMPTY)}>
          New pool
        </button>
      </div>
      <p className="muted">
        A pool is a named set of questions (e.g. &quot;Week 3: JOINs&quot;) you can assign to a
        class match once rooms exist.
      </p>
      <ErrorMessage error={pools.error ?? remove.error} />

      <div className="grid-2">
        <div className="card">
          {pools.data?.length === 0 && <p className="muted">No pools yet.</p>}
          <table>
            <tbody>
              {pools.data?.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => edit(p)}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="muted">{p.description}</div>
                  </td>
                  <td className="num">{p.questionIds.length} questions</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="danger"
                      onClick={() =>
                        window.confirm(`Delete pool "${p.name}"?`) && remove.mutate(p.id)
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {form && (
          <div className="card stack">
            <h2>{form.id ? 'Edit pool' : 'New pool'}</h2>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Description
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <strong>Questions ({form.questionIds.length} selected)</strong>
            <div className="pool-picker">
              {questions.data?.map((q) => (
                <label key={q.id} className="inline">
                  <input
                    type="checkbox"
                    checked={form.questionIds.includes(q.id)}
                    onChange={() => toggle(q.id)}
                  />
                  <span>
                    T{q.tier} · {q.title} <code>{q.slug}</code>
                  </span>
                </label>
              ))}
            </div>
            <ErrorMessage error={save.error} />
            <div className="row">
              <button onClick={() => setForm(null)}>Cancel</button>
              <span className="spacer" />
              <button
                className="primary"
                disabled={save.isPending || !form.name.trim()}
                onClick={() =>
                  save.mutate(
                    {
                      ...(form.id === undefined ? {} : { id: form.id }),
                      name: form.name,
                      description: form.description,
                      questionIds: form.questionIds,
                    },
                    { onSuccess: () => setForm(null) },
                  )
                }
              >
                Save pool
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
