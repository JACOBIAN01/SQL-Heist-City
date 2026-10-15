import { useEffect, useMemo, useState } from 'react';
import type { BriefView } from '@heist/shared';
import { useBriefs, useMarkBrief, type BriefStatus } from '../api/analytics';
import { ErrorMessage } from '../components/ErrorMessage';
import { InlineMarkdown } from '../components/InlineMarkdown';

/**
 * The marking queue for open briefs (Build, Phase 17.11). Briefs come in from the game between
 * rounds; the teacher marks each criterion of the rubric, and "Save and next" moves straight on,
 * so a stack of 30 is marked in one sitting. Marks go into the student's profile at once.
 */
export function BriefsPage() {
  const [status, setStatus] = useState<BriefStatus>('unmarked');
  const briefs = useBriefs(status);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useMemo(() => briefs.data?.briefs ?? [], [briefs.data]);
  const open = list.find((b) => b.id === openId) ?? null;

  // Start on the first brief; after a save the list refreshes and the next one is first.
  useEffect(() => {
    if (!open && list.length > 0) setOpenId(list[0]?.id ?? null);
  }, [open, list]);

  return (
    <div className="stack">
      <div className="row">
        <h1>Briefs to mark</h1>
        <span className="spacer" />
        <label>
          Show{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value as BriefStatus)}>
            <option value="unmarked">Not marked yet</option>
            <option value="marked">Marked</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Students write these between rounds: a goal, when they are done, their queries and how they
        know it worked. Mark each criterion; the marks count as Build in their profile.
      </p>
      <ErrorMessage error={briefs.error} />
      {list.length === 0 && !briefs.isLoading && <p className="muted">Nothing here.</p>}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <ul className="card stack" aria-label="Briefs" style={{ minWidth: 220 }}>
          {list.map((b) => (
            <li key={b.id}>
              <button
                className={b.id === open?.id ? 'primary' : ''}
                aria-current={b.id === open?.id}
                onClick={() => setOpenId(b.id)}
              >
                {b.playerName ?? 'Student'} · {b.title}
                {b.marks ? ` · ${sum(b.marks)}/${sum(b.rubric.map((r) => r.marks))}` : ''}
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <MarkForm
            key={open.id}
            brief={open}
            position={`${list.indexOf(open) + 1} of ${list.length}`}
            onNext={() => {
              const next = list[list.indexOf(open) + 1];
              setOpenId(status === 'unmarked' ? (next?.id ?? null) : (next?.id ?? open.id));
            }}
          />
        )}
      </div>
    </div>
  );
}

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

function MarkForm({
  brief,
  position,
  onNext,
}: {
  brief: BriefView;
  position: string;
  onNext: () => void;
}) {
  const save = useMarkBrief();
  const [marks, setMarks] = useState<number[]>(() =>
    brief.rubric.map((_, i) => brief.marks?.[i] ?? 0),
  );
  const [feedback, setFeedback] = useState(brief.feedback ?? '');
  const total = sum(brief.rubric.map((r) => r.marks));

  const submit = () =>
    save.mutate(
      { id: brief.id, mark: { marks, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) } },
      { onSuccess: onNext },
    );

  return (
    <div className="card stack" style={{ flex: 1 }}>
      <div className="row">
        <h2>{brief.title}</h2>
        <span className="spacer" />
        <span className="muted">{position}</span>
      </div>
      <p className="muted">
        {brief.playerName ?? 'Student'}
        {brief.round !== null ? ` · round ${brief.round}` : ''} · handed in{' '}
        {new Date(brief.submittedAt).toLocaleString()}
      </p>
      <InlineMarkdown text={brief.story} />
      <h3>Their write-up</h3>
      <pre className="brief-text" style={{ whiteSpace: 'pre-wrap' }}>
        {brief.text || '(empty)'}
      </pre>
      <h3>Their queries</h3>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{brief.sql || '(none)'}</pre>
      <h3>Rubric</h3>
      <table className="table">
        <tbody>
          {brief.rubric.map((r, i) => (
            <tr key={r.criterion}>
              <td>{r.criterion}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={r.marks}
                  aria-label={`${r.criterion} (out of ${r.marks})`}
                  value={marks[i] ?? 0}
                  onChange={(e) => {
                    const next = [...marks];
                    next[i] = Math.max(0, Math.min(r.marks, Math.round(Number(e.target.value))));
                    setMarks(next);
                  }}
                />{' '}
                / {r.marks}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Total: {sum(marks)} / {total}
      </p>
      <label>
        Feedback for the student (optional)
        <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </label>
      <ErrorMessage error={save.error} />
      <div className="row">
        <span className="spacer" />
        {brief.marks && (
          <span className="muted">Marked by {brief.markedBy}; saving re-marks it.</span>
        )}
        <button className="primary" disabled={save.isPending} onClick={submit}>
          Save and next
        </button>
      </div>
    </div>
  );
}
