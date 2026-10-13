import { useEffect, useState } from 'react';
import { useConcepts, useSaveConcept, type ConceptCardView } from '../api/classes';
import { ErrorMessage } from '../components/ErrorMessage';
import { InlineMarkdown } from '../components/InlineMarkdown';

const BLANK = { topic: '', title: '', nudge: '', body_md: '' };

/** One short explainer per SQL topic: shown as a hint step, after a round, and in the review. */
export function ConceptsPage() {
  const cards = useConcepts();
  const save = useSaveConcept();
  const [form, setForm] = useState<typeof BLANK | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (save.isSuccess) setForm(null);
  }, [save.isSuccess]);

  const edit = (c: ConceptCardView) =>
    setForm({ topic: c.topic, title: c.title, nudge: c.nudge, body_md: c.body_md });
  const rows = (cards.data ?? []).filter(
    (c) =>
      !filter ||
      c.topic.includes(filter.toLowerCase()) ||
      c.title.toLowerCase().includes(filter.toLowerCase()),
  );
  const isNew = form !== null && !(cards.data ?? []).some((c) => c.topic === form.topic);

  return (
    <div className="stack">
      <div className="row">
        <h1>Concept cards</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setForm(BLANK)}>
          New card
        </button>
      </div>
      <p className="muted">
        A short explainer for each SQL topic. Players get its first line as a free hint, the whole
        card as the next hint, and again after the round. Every edit is saved as a new version.
      </p>
      <ErrorMessage error={cards.error ?? save.error} />
      <div className="grid-2">
        <div className="card stack">
          <input
            aria-label="Filter cards"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <table>
            <tbody>
              {rows.map((c) => (
                <tr key={c.topic} className="clickable" onClick={() => edit(c)}>
                  <td>
                    <strong>{c.title}</strong>
                    <div className="muted">{c.topic}</div>
                  </td>
                  <td className="num">v{c.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {form && (
          <div className="card stack">
            <h2>{isNew ? 'New card' : `Edit ${form.topic}`}</h2>
            <label>
              Topic (as used in questions, e.g. group-by)
              <input
                aria-label="Topic"
                value={form.topic}
                disabled={!isNew}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
              />
            </label>
            <label>
              Title
              <input
                aria-label="Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Free hint (one line)
              <input
                aria-label="Free hint"
                value={form.nudge}
                onChange={(e) => setForm({ ...form, nudge: e.target.value })}
              />
            </label>
            <label>
              The card
              <textarea
                aria-label="The card"
                rows={6}
                value={form.body_md}
                onChange={(e) => setForm({ ...form, body_md: e.target.value })}
              />
            </label>
            <div>
              <div className="muted">Preview</div>
              <InlineMarkdown text={form.body_md} />
            </div>
            <div className="row">
              <button onClick={() => setForm(null)}>Cancel</button>
              <span className="spacer" />
              <button
                className="primary"
                disabled={save.isPending}
                onClick={() => save.mutate(form)}
              >
                Save card
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
