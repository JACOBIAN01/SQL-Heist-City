import { useState } from 'react';
import type { QuestionTemplateInput, SeedPreview } from '@heist/shared';
import { usePreview } from '../api/questions';
import { CodeEditor } from '../components/CodeEditor';
import { ErrorMessage } from '../components/ErrorMessage';
import { ResultTable } from '../components/ResultTable';

/**
 * Runs the current (unsaved) draft exactly like the game would: one variant
 * per seed, reference query in the sandbox, optional student query graded.
 */
export function PreviewPanel({ template }: { template: QuestionTemplateInput }) {
  const preview = usePreview();
  const [count, setCount] = useState(3);
  const [studentSql, setStudentSql] = useState('');

  const run = () =>
    preview.mutate({
      template,
      seeds: Array.from({ length: count }, (_, i) => `preview-${i + 1}`),
      ...(studentSql.trim() ? { studentSql } : {}),
    });

  const report = preview.data;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <label>
            Seeds (players)
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value))))}
            />
          </label>
          <span className="spacer" />
          <button className="primary" onClick={run} disabled={preview.isPending}>
            {preview.isPending ? 'Running…' : 'Run preview'}
          </button>
        </div>
        <strong>Try a student answer (optional)</strong>
        <CodeEditor
          label="Student SQL"
          language="sql"
          value={studentSql}
          onChange={setStudentSql}
          placeholder="SELECT …"
        />
      </div>

      <ErrorMessage error={preview.error} />

      {report && (
        <>
          <div className="row">
            <span className={`badge ${report.ok ? 'ok' : 'off'}`}>
              {report.ok ? 'All seeds OK' : 'Problems found'}
            </span>
            <span className="badge">
              {Math.round(report.distinctResultRatio * 100)}% of seeds have a unique answer
              {report.distinctResultRatio < 0.8 ? ' — consider more varied params/data' : ''}
            </span>
          </div>
          {report.seeds.map((s) => (
            <SeedCard key={s.seed} seed={s} />
          ))}
        </>
      )}
    </div>
  );
}

function SeedCard({ seed }: { seed: SeedPreview }) {
  return (
    <div className="card stack" data-testid={`seed-${seed.seed}`}>
      <div className="row">
        <strong>Seed {seed.seed}</strong>
        {seed.issues.map((i) => (
          <span key={i} className={`badge ${i === 'slow' ? 'warn' : 'off'}`}>
            {i}
          </span>
        ))}
        <span className="muted">{seed.runtimeMs.toFixed(0)} ms</span>
        <span className="spacer" />
        {seed.student && (
          <span className={`badge ${seed.student.status === 'correct' ? 'ok' : 'off'}`}>
            student: {seed.student.status}
          </span>
        )}
      </div>
      {seed.error && <div className="error">{seed.error}</div>}
      {seed.student?.feedback && <p>{seed.student.feedback.message}</p>}
      {seed.story && <p className="story">{seed.story}</p>}
      {seed.referenceSql && <pre>{seed.referenceSql}</pre>}
      {seed.expected && (
        <>
          <strong>
            Expected answer ({seed.expected.rows.length} row
            {seed.expected.rows.length === 1 ? '' : 's'})
          </strong>
          <ResultTable columns={seed.expected.columns} rows={seed.expected.rows} max={20} />
        </>
      )}
      {seed.tables?.map((t) => (
        <details key={t.name}>
          <summary>
            Table <code>{t.name}</code> — {t.rows.length} rows
          </summary>
          <ResultTable columns={t.columns} rows={t.rows} />
        </details>
      ))}
    </div>
  );
}
