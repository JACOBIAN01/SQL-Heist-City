import { useState } from 'react';
import type { CustomHeistSpec } from '@heist/shared';
import {
  useCustomHeists,
  useDeleteCustomHeist,
  useImportCustomHeist,
  useSaveCustomHeist,
  type CustomHeist,
} from '../api/customHeists';
import { ErrorMessage } from '../components/ErrorMessage';

interface Form {
  id?: number;
  name: string;
  title: string;
  /** One line per row: "Speaker: what they say". */
  story: string;
  bank: number;
  /** One question slug per row, in the order of the locks. */
  locks: string;
  roundMinutes: number;
}

const EMPTY: Form = {
  name: '',
  title: 'The job',
  story: 'Crew: Here is the plan.',
  bank: 1,
  locks: '',
  roundMinutes: 15,
};

/** "Mae: Quietly now." → a line; a row without a speaker is said by the crew. */
export function parseStory(text: string): { speaker: string; text: string }[] {
  return text
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const i = row.indexOf(':');
      return i > 0 && i < 40
        ? { speaker: row.slice(0, i).trim(), text: row.slice(i + 1).trim() }
        : { speaker: 'Crew', text: row };
    });
}

const toSpec = (f: Form): CustomHeistSpec => ({
  name: f.name,
  story: { title: f.title, lines: parseStory(f.story) },
  bank: f.bank,
  locks: f.locks
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
  roundMinutes: f.roundMinutes,
});

const fromHeist = (h: CustomHeist): Form => ({
  id: h.id,
  name: h.spec.name,
  title: h.spec.story.title,
  story: h.spec.story.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n'),
  bank: h.spec.bank,
  locks: h.spec.locks.join('\n'),
  roundMinutes: h.spec.roundMinutes,
});

/** A teacher's own heists (Phase 34.5): a story and a chain of questions, shared by code. */
export function CustomHeistsPage() {
  const heists = useCustomHeists();
  const save = useSaveCustomHeist();
  const remove = useDeleteCustomHeist();
  const importer = useImportCustomHeist();
  const [form, setForm] = useState<Form | null>(null);
  const [code, setCode] = useState('');

  return (
    <div className="stack">
      <div className="row">
        <h1>My heists</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setForm(EMPTY)}>
          New heist
        </button>
      </div>
      <p className="muted">
        A heist is a short story and a chain of questions, played on one bank: each lock of the
        vault asks the next question, the same for the whole class. Pick it as a class&apos;s game
        mode to play it, and give its share code to another teacher so they can copy it.
      </p>
      <ErrorMessage error={heists.error ?? remove.error ?? importer.error} />

      <div className="card">
        <label>
          Copy a heist by share code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345" />
        </label>
        <button disabled={code.trim() === ''} onClick={() => importer.mutate(code.trim())}>
          Copy it
        </button>
      </div>

      <div className="grid-2">
        <div className="card">
          {heists.data?.length === 0 && <p className="muted">No heists yet.</p>}
          <table>
            <tbody>
              {heists.data?.map((h) => (
                <tr key={h.id} className="clickable" onClick={() => setForm(fromHeist(h))}>
                  <td>
                    <strong>{h.name}</strong>
                    <div className="muted">
                      Bank {h.spec.bank} · {h.spec.locks.length} questions · mode{' '}
                      <code>{h.mode}</code>
                    </div>
                  </td>
                  <td>
                    Share code <code>{h.shareCode}</code>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="danger"
                      onClick={() => window.confirm(`Delete "${h.name}"?`) && remove.mutate(h.id)}
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
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { ...(form.id === undefined ? {} : { id: form.id }), spec: toSpec(form) },
                { onSuccess: () => setForm(null) },
              );
            }}
          >
            <ErrorMessage error={save.error} />
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label>
              Story title
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Story (one line per row, &quot;Name: what they say&quot;)
              <textarea
                rows={4}
                value={form.story}
                onChange={(e) => setForm({ ...form, story: e.target.value })}
              />
            </label>
            <label>
              Bank
              <select
                value={form.bank}
                onChange={(e) => setForm({ ...form, bank: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((b) => (
                  <option key={b} value={b}>
                    Bank {b}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Questions, one slug per row, in lock order (1 to 5)
              <textarea
                rows={4}
                value={form.locks}
                onChange={(e) => setForm({ ...form, locks: e.target.value })}
                required
              />
            </label>
            <label>
              Round (minutes)
              <input
                type="number"
                min={1}
                max={120}
                value={form.roundMinutes}
                onChange={(e) => setForm({ ...form, roundMinutes: Number(e.target.value) })}
              />
            </label>
            <div className="row">
              <button className="primary" type="submit">
                Save heist
              </button>
              <button type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
