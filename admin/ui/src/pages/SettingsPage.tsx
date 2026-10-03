import { useEffect, useState } from 'react';
import type { ChallengeSettings, RewardTierEntry } from '@heist/shared';
import {
  useChallengeSettings,
  useRewardMap,
  useSaveChallengeSettings,
  useSaveRewardMap,
} from '../api/config';
import { useMe } from '../auth/useMe';
import { ErrorMessage } from '../components/ErrorMessage';

type NumericKey = Exclude<keyof ChallengeSettings, 'hintCostMode'>;

const FIELDS: { key: NumericKey; label: string; unit: string }[] = [
  { key: 'lockoutSec', label: 'Lockout after a wrong answer', unit: 's' },
  { key: 'ttlSec', label: 'Challenge expires after', unit: 's' },
  { key: 'runCooldownMs', label: 'Min gap between "Run" presses', unit: 'ms' },
  { key: 'submitCooldownMs', label: 'Min gap between "Submit" presses', unit: 'ms' },
  { key: 'requestCooldownMs', label: 'Min gap between new challenges', unit: 'ms' },
  { key: 'sampleRows', label: 'Sample rows shown per table', unit: 'rows' },
];

const REWARD_LABELS: Record<string, string> = {
  'heal:small': 'Heal +20',
  'heal:medium': 'Heal +50',
  'heal:full': 'Full heal',
  'ammo:refill': 'Ammo refill',
  'gun:pistol': 'Pistol',
  'gun:smg': 'SMG',
  'gun:shotgun': 'Shotgun',
  'gun:rifle': 'Rifle',
  'gun:sniper': 'Sniper',
};

export function SettingsPage() {
  const isAdmin = useMe().data?.role === 'admin';
  return (
    <div className="stack">
      <h1>Settings</h1>
      {!isAdmin && <p className="muted">Only admins can change these values.</p>}
      <div className="grid-2">
        <ChallengeSettingsCard editable={isAdmin} />
        <RewardMapCard editable={isAdmin} />
      </div>
    </div>
  );
}

function ChallengeSettingsCard({ editable }: { editable: boolean }) {
  const settings = useChallengeSettings();
  const save = useSaveChallengeSettings();
  const [form, setForm] = useState<ChallengeSettings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data.current);
  }, [settings.data]);

  if (!form || !settings.data) return <ErrorMessage error={settings.error} />;
  const defaults = settings.data.defaults;
  return (
    <div className="card stack">
      <h2>Challenge rules</h2>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label} ({f.unit})
          <input
            type="number"
            min={0}
            disabled={!editable}
            value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
          />
          {form[f.key] !== defaults[f.key] && (
            <span className="muted">default {defaults[f.key]}</span>
          )}
        </label>
      ))}
      <label>
        How hint costs are charged
        <select
          disabled={!editable}
          value={form.hintCostMode}
          onChange={(e) =>
            setForm({ ...form, hintCostMode: e.target.value as ChallengeSettings['hintCostMode'] })
          }
        >
          <option value="fraction">Fraction of carried cash (0.05 = 5%)</option>
          <option value="absolute">Fixed amount</option>
        </select>
        {form.hintCostMode !== defaults.hintCostMode && (
          <span className="muted">default {defaults.hintCostMode}</span>
        )}
      </label>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <button onClick={() => setForm(defaults)}>Reset to defaults</button>
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate(form)}>
            Save rules
          </button>
        </div>
      )}
    </div>
  );
}

function RewardMapCard({ editable }: { editable: boolean }) {
  const rewards = useRewardMap();
  const save = useSaveRewardMap();
  const [rows, setRows] = useState<RewardTierEntry[] | null>(null);
  useEffect(() => {
    if (rewards.data) setRows(rewards.data);
  }, [rewards.data]);

  if (!rows) return <ErrorMessage error={rewards.error} />;
  const setTier = (key: string, field: 'min' | 'max', value: number) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <div className="card stack">
      <h2>Question tier per reward</h2>
      <p className="muted">
        Which question difficulty (1 easy – 5 expert) a player must solve to earn each reward.
      </p>
      <table>
        <thead>
          <tr>
            <th>Reward</th>
            <th>Min tier</th>
            <th>Max tier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                {REWARD_LABELS[r.key] ?? r.key}{' '}
                {!r.isDefault && <span className="badge warn">custom</span>}
              </td>
              {(['min', 'max'] as const).map((field) => (
                <td key={field}>
                  <select
                    aria-label={`${r.key} ${field}`}
                    disabled={!editable}
                    value={r[field]}
                    onChange={(e) => setTier(r.key, field, Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Vault locks use the bank&apos;s tier: lock k asks tier min(5, bank tier + k − 1).
      </p>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending}
            onClick={() => save.mutate(rows.map(({ key, min, max }) => ({ key, min, max })))}
          >
            Save tiers
          </button>
        </div>
      )}
    </div>
  );
}
