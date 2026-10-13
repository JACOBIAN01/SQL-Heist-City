import { useEffect, useState } from 'react';
import { useSaveSection, useSection, type SectionName } from '../api/config';
import { ErrorMessage } from '../components/ErrorMessage';
import { changes, labelOf, leaves, read, withLeaf } from './sectionFields';

/**
 * One editable block of plain numbers (heist rules, cars, time of day, the
 * city), drawn from whatever the server sends, so a new setting appears here
 * with no UI change. Only edited fields are sent.
 */
export function SectionCard({
  name,
  title,
  note,
  editable,
}: {
  name: SectionName;
  title: string;
  note: string;
  editable: boolean;
}) {
  const section = useSection(name);
  const save = useSaveSection(name);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (section.data) setForm(section.data.current);
  }, [section.data]);

  if (!form || !section.data) return <ErrorMessage error={section.error} />;
  const { current, defaults } = section.data;
  const dirty = Object.keys(changes(form, current)).length > 0;
  return (
    <div className="card stack">
      <h2>{title}</h2>
      <p className="muted">{note}</p>
      <div className="settings-grid">
        {leaves(form).map((leaf) => {
          const id = leaf.path.join('.');
          const original = read(defaults, leaf.path);
          return (
            <label key={id}>
              {labelOf(leaf.path)}
              <input
                aria-label={`${name} ${id}`}
                type={typeof leaf.value === 'number' ? 'number' : 'text'}
                step="any"
                disabled={!editable}
                value={leaf.value}
                onChange={(e) =>
                  setForm(
                    withLeaf(
                      form,
                      leaf.path,
                      typeof leaf.value === 'number' ? Number(e.target.value) : e.target.value,
                    ),
                  )
                }
              />
              {original !== undefined && original !== leaf.value && (
                <span className="muted">default {String(original)}</span>
              )}
            </label>
          );
        })}
      </div>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <button onClick={() => setForm(defaults)}>Reset to defaults</button>
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate(changes(form, current))}
          >
            Save {title.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
