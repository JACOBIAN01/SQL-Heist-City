import { useEffect, useState } from 'react';
import { CHEAT_CODE_MIN_LENGTH, CHEAT_SCOPES, type CheatAdminView } from '@heist/shared';
import { useCheatSettings, useSaveCheatSettings } from '../api/config';
import { ErrorMessage } from '../components/ErrorMessage';

const SCOPE_NOTES: Record<(typeof CHEAT_SCOPES)[number], string> = {
  off: 'Off: nobody can use it.',
  dev: 'Local and staging servers only.',
  tutorial: 'The tutorial only.',
  rooms: 'The classes listed below.',
  all: 'Every match. Anyone who learns the code can skip every question.',
};

/**
 * The owner's cheat code (Phase 37): where it works, the key combination that opens the prompt, and
 * the code itself. The code is write-only: it is stored as a hash and cannot be read back.
 */
export function CheatCard({ editable }: { editable: boolean }) {
  const settings = useCheatSettings();
  const save = useSaveCheatSettings();
  const [form, setForm] = useState<CheatAdminView | null>(null);
  const [classes, setClasses] = useState('');
  const [newCode, setNewCode] = useState('');
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!settings.data) return;
    setForm(settings.data.current);
    setClasses(settings.data.current.classIds.join(', '));
  }, [settings.data]);

  // Record the combination: hold the keys together; it is taken when the first one is released.
  useEffect(() => {
    if (!recording) return;
    const held = new Set<string>();
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      held.add(e.code);
    };
    const up = () => {
      if (held.size >= 2 && held.size <= 3) setForm((f) => (f ? { ...f, combo: [...held] } : f));
      setRecording(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [recording]);

  if (!form || !settings.data) return <ErrorMessage error={settings.error} />;
  const set = <K extends keyof CheatAdminView>(key: K, value: CheatAdminView[K]) =>
    setForm({ ...form, [key]: value });
  const classIds = classes
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return (
    <div className="card stack">
      <h2>Cheat code</h2>
      <p className="muted">
        A secret key combination opens a prompt; the right code passes the question that is open.
        The reward is paid if you choose, but it earns no XP, marks, streak or leaderboard place and
        shows in reports as a cheat. The code is checked on the server and stored only as a hash.
      </p>
      <label>
        Where it works
        <select
          disabled={!editable}
          aria-label="Cheat scope"
          value={form.scope}
          onChange={(e) => set('scope', e.target.value as CheatAdminView['scope'])}
        >
          {CHEAT_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="muted">{SCOPE_NOTES[form.scope]}</span>
      </label>
      {form.scope === 'rooms' && (
        <label>
          Class ids (comma separated)
          <input
            aria-label="Cheat class ids"
            disabled={!editable}
            value={classes}
            onChange={(e) => setClasses(e.target.value)}
          />
        </label>
      )}
      <div className="row">
        <span>
          Key combination: <strong>{form.combo.join(' + ')}</strong>
        </span>
        {editable && (
          <button type="button" onClick={() => setRecording(true)}>
            {recording ? 'Hold the keys now…' : 'Record a new combination'}
          </button>
        )}
      </div>
      <label>
        {form.codeSet ? 'Replace the code' : 'Set the code'}
        <input
          aria-label="New cheat code"
          type="password"
          autoComplete="new-password"
          disabled={!editable}
          value={newCode}
          placeholder={form.codeSet ? 'A code is set (cannot be shown)' : 'Not set'}
          onChange={(e) => setNewCode(e.target.value)}
        />
        <span className="muted">At least {CHEAT_CODE_MIN_LENGTH} characters.</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          disabled={!editable}
          checked={form.payReward}
          onChange={(e) => set('payReward', e.target.checked)}
        />
        Pay the question&apos;s reward when it is passed
      </label>
      <label>
        Passes per player per round (0 = no limit)
        <input
          type="number"
          aria-label="Cheat passes per round"
          disabled={!editable}
          value={form.maxPerRound}
          onChange={(e) => set('maxPerRound', Number(e.target.value))}
        />
      </label>
      <label>
        Wrong codes before a lockout
        <input
          type="number"
          aria-label="Cheat lockout tries"
          disabled={!editable}
          value={form.lockoutTries}
          onChange={(e) => set('lockoutTries', Number(e.target.value))}
        />
      </label>
      <label>
        Lockout length (seconds)
        <input
          type="number"
          aria-label="Cheat lockout seconds"
          disabled={!editable}
          value={form.lockoutSeconds}
          onChange={(e) => set('lockoutSeconds', Number(e.target.value))}
        />
      </label>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending}
            onClick={() => {
              const { codeSet: _set, ...rest } = form;
              save.mutate({ ...rest, classIds, ...(newCode ? { newCode } : {}) });
              setNewCode('');
            }}
          >
            Save cheat settings
          </button>
        </div>
      )}
    </div>
  );
}
