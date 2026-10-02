import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDeleteQuestion, useQuestion, useSaveQuestion } from '../api/questions';
import { useMe } from '../auth/useMe';
import { CodeEditor } from '../components/CodeEditor';
import { ErrorMessage } from '../components/ErrorMessage';
import { STARTER_TEMPLATE, fromDraft, toDraft, type Draft } from '../questions/draft';
import { PreviewPanel } from '../questions/PreviewPanel';
import { VersionsPanel } from '../questions/VersionsPanel';

type Tab = 'edit' | 'preview' | 'versions';

export function QuestionEditorPage() {
  const params = useParams();
  const isNew = params.id === 'new';
  const id = isNew ? undefined : Number(params.id);
  const question = useQuestion(id);
  const navigate = useNavigate();
  const me = useMe();
  const save = useSaveQuestion();
  const remove = useDeleteQuestion();
  const [draft, setDraft] = useState<Draft | null>(isNew ? toDraft(STARTER_TEMPLATE) : null);
  const [tab, setTab] = useState<Tab>('edit');
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  // Load (or reload after save/rollback) the stored template into the form.
  const loaded = question.data;
  useEffect(() => {
    if (loaded) setDraft(toDraft(loaded.template));
  }, [loaded]);

  if (!isNew && question.isPending) return <p className="muted">Loading…</p>;
  if (question.isError) return <ErrorMessage error={question.error} />;
  if (!draft) return null;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };

  function onSave() {
    if (!draft) return;
    const result = fromDraft(draft);
    if (!result.ok) return setLocalErrors(result.errors);
    setLocalErrors([]);
    save.mutate(
      { ...(id === undefined ? {} : { id }), template: result.template },
      {
        onSuccess: (q) => {
          setSaved(true);
          if (isNew && q) void navigate(`/questions/${q.id}`, { replace: true });
        },
      },
    );
  }

  function onDelete() {
    if (id === undefined) return;
    if (!window.confirm('Delete this question? It disappears from the game; its history is kept.'))
      return;
    remove.mutate(id, { onSuccess: () => void navigate('/questions') });
  }

  const built = fromDraft(draft);

  return (
    <div className="stack">
      <div className="row">
        <h1>{isNew ? 'New question' : draft.title}</h1>
        {loaded && <span className="badge">v{loaded.version}</span>}
        <span className="spacer" />
        {saved && <span className="notice">Saved ✓</span>}
        {me.data?.role === 'admin' && !isNew && (
          <button className="danger" onClick={onDelete} disabled={remove.isPending}>
            Delete
          </button>
        )}
        <button className="primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Validating & saving…' : 'Save'}
        </button>
      </div>

      {localErrors.length > 0 && (
        <div className="error" role="alert">
          <ul>
            {localErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <ErrorMessage error={save.error ?? remove.error} />

      <div className="tabs" role="tablist">
        {(['edit', 'preview', ...(isNew ? [] : ['versions'])] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t === 'edit' ? 'Edit' : t === 'preview' ? 'Preview & test' : 'Versions'}
          </button>
        ))}
      </div>

      {tab === 'edit' && (
        <div className="stack">
          <div className="grid-2">
            <div className="card stack">
              <label>
                Title
                <input value={draft.title} onChange={(e) => set('title', e.target.value)} />
              </label>
              <label>
                Slug
                <input value={draft.slug} onChange={(e) => set('slug', e.target.value)} />
              </label>
              <div className="row">
                <label>
                  Tier
                  <select value={draft.tier} onChange={(e) => set('tier', Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: 1 }}>
                  Topics (comma-separated)
                  <input value={draft.topics} onChange={(e) => set('topics', e.target.value)} />
                </label>
              </div>
              <div className="row">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => set('enabled', e.target.checked)}
                  />
                  Enabled in game
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={draft.order_matters}
                    onChange={(e) => set('order_matters', e.target.checked)}
                  />
                  Row order matters
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={draft.allow_empty}
                    onChange={(e) => set('allow_empty', e.target.checked)}
                  />
                  Empty answer allowed
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={draft.compare_names}
                    onChange={(e) => set('compare_names', e.target.checked)}
                  />
                  Column names must match
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={draft.compare_case}
                    onChange={(e) => set('compare_case', e.target.checked)}
                  />
                  Case-sensitive text
                </label>
              </div>
            </div>
            <div className="card stack">
              <label>
                Story (Markdown; use {'{param}'} placeholders)
                <textarea
                  rows={6}
                  value={draft.story_md}
                  onChange={(e) => set('story_md', e.target.value)}
                />
              </label>
              <div className="stack">
                <strong>Hints</strong>
                {draft.hints.map((h, i) => (
                  <div className="row" key={i}>
                    <input
                      aria-label={`Hint ${i + 1} text`}
                      style={{ flex: 1 }}
                      value={h.text}
                      onChange={(e) =>
                        set(
                          'hints',
                          draft.hints.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                        )
                      }
                    />
                    <input
                      aria-label={`Hint ${i + 1} cost`}
                      type="number"
                      step="0.01"
                      min="0"
                      style={{ width: 90 }}
                      value={h.cost}
                      onChange={(e) =>
                        set(
                          'hints',
                          draft.hints.map((x, j) =>
                            j === i ? { ...x, cost: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    />
                    <button
                      onClick={() =>
                        set(
                          'hints',
                          draft.hints.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div>
                  <button onClick={() => set('hints', [...draft.hints, { text: '', cost: 0.05 }])}>
                    Add hint
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="stack">
              <strong>Schema (CREATE TABLE …)</strong>
              <CodeEditor
                label="Schema SQL"
                language="sql"
                value={draft.schema_sql}
                onChange={(v) => set('schema_sql', v)}
              />
            </div>
            <div className="stack">
              <strong>Reference answer (never shown to players)</strong>
              <CodeEditor
                label="Reference SQL"
                language="sql"
                value={draft.reference_sql}
                onChange={(v) => set('reference_sql', v)}
              />
            </div>
            <div className="stack">
              <strong>Generated data (data_gen)</strong>
              <CodeEditor
                label="data_gen JSON"
                language="json"
                value={draft.data_gen}
                onChange={(v) => set('data_gen', v)}
                minLines={10}
              />
            </div>
            <div className="stack">
              <strong>Parameters (params)</strong>
              <CodeEditor
                label="params JSON"
                language="json"
                value={draft.params}
                onChange={(v) => set('params', v)}
                minLines={10}
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'preview' &&
        (built.ok ? (
          <PreviewPanel template={built.template} />
        ) : (
          <ErrorMessage error={new Error(built.errors.join('; '))} />
        ))}

      {tab === 'versions' && id !== undefined && <VersionsPanel id={id} />}
    </div>
  );
}
