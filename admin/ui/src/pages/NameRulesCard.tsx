import { useEffect, useState } from 'react';
import type { NameRules } from '@heist/shared';
import { useSaveSection, useSection } from '../api/config';
import { ErrorMessage } from '../components/ErrorMessage';

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Which words a display name may not contain, and the names that are fine despite containing one. */
export function NameRulesCard({ editable }: { editable: boolean }) {
  const section = useSection('names');
  const save = useSaveSection('names');
  const [blocked, setBlocked] = useState('');
  const [allowed, setAllowed] = useState('');
  useEffect(() => {
    if (!section.data) return;
    const current = section.data.current as unknown as NameRules;
    setBlocked(current.blocked.join('\n'));
    setAllowed(current.allowed.join('\n'));
  }, [section.data]);

  if (!section.data) return <ErrorMessage error={section.error} />;
  const defaults = section.data.defaults as unknown as NameRules;
  return (
    <div className="card stack">
      <h2>Player names</h2>
      <p className="muted">
        Words a display name may not contain, even disguised (sh1t, s.h.i.t). The starting list is
        short and English only: add the words and languages your schools need, one per line.
      </p>
      <label>
        Blocked words
        <textarea
          rows={8}
          disabled={!editable}
          value={blocked}
          onChange={(e) => setBlocked(e.target.value)}
        />
      </label>
      <label>
        Names that are fine even though they contain a blocked word
        <textarea
          rows={3}
          disabled={!editable}
          value={allowed}
          onChange={(e) => setAllowed(e.target.value)}
        />
      </label>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <button
            onClick={() => {
              setBlocked(defaults.blocked.join('\n'));
              setAllowed(defaults.allowed.join('\n'));
            }}
          >
            Reset to defaults
          </button>
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending}
            onClick={() => save.mutate({ blocked: lines(blocked), allowed: lines(allowed) })}
          >
            Save names
          </button>
        </div>
      )}
    </div>
  );
}
