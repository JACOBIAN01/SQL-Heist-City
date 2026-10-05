import { useEffect, useState } from 'react';
import type { ChallengeSettings, CombatSettings, RewardTierEntry, WeaponSpec } from '@heist/shared';
import {
  useChallengeSettings,
  useCombatSettings,
  useRewardMap,
  useSaveChallengeSettings,
  useSaveCombatSettings,
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
      <GunsCard editable={isAdmin} />
    </div>
  );
}

type GunField = keyof WeaponSpec;

const GUN_FIELDS: { key: GunField; label: string; step: number; title: string }[] = [
  { key: 'damage', label: 'Damage', step: 1, title: 'Per bullet (per pellet for the shotgun)' },
  { key: 'rpm', label: 'RPM', step: 10, title: 'Rounds per minute' },
  { key: 'range', label: 'Range m', step: 5, title: 'Bullets stop here' },
  { key: 'magSize', label: 'Mag', step: 1, title: 'Rounds per magazine' },
  { key: 'pellets', label: 'Pellets', step: 1, title: 'Bullets per shot' },
  { key: 'spread', label: 'Spread', step: 0.005, title: 'Cone half-angle (rad), hip, standing' },
  { key: 'falloffStart', label: 'Falloff m', step: 1, title: 'Full damage to here' },
  { key: 'falloffMin', label: 'Min dmg', step: 0.05, title: 'Damage share left at full range' },
  { key: 'moveSpread', label: 'Move spread', step: 0.005, title: 'Extra spread at a sprint (rad)' },
  { key: 'aimSpread', label: 'Aim spread', step: 0.05, title: 'Spread multiplier while aiming' },
  { key: 'aimZoom', label: 'Zoom', step: 0.1, title: 'View zoom while aiming (1 = none)' },
  { key: 'recoil', label: 'Recoil', step: 0.005, title: 'View kick per shot (rad)' },
];

/** Every gun's numbers. Changes reach matches at their next round. */
function GunsCard({ editable }: { editable: boolean }) {
  const settings = useCombatSettings();
  const save = useSaveCombatSettings();
  const [guns, setGuns] = useState<CombatSettings['weapons'] | null>(null);
  useEffect(() => {
    if (settings.data) setGuns(settings.data.current.weapons);
  }, [settings.data]);

  if (!guns || !settings.data) return <ErrorMessage error={settings.error} />;
  const defaults = settings.data.defaults.weapons;
  const setField = (id: string, key: GunField, value: string) =>
    setGuns({
      ...guns,
      [id]: { ...guns[id], [key]: value === '' ? undefined : Number(value) } as WeaponSpec,
    });

  return (
    <div className="card stack">
      <h2>Guns</h2>
      <p className="muted">
        Each gun&apos;s numbers. Changes apply in every match from its next round. Hover a heading
        for what it means.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gun</th>
              {GUN_FIELDS.map((f) => (
                <th key={f.key} title={f.title}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(guns).map(([id, spec]) => (
              <tr key={id}>
                <td>{REWARD_LABELS[`gun:${id}`] ?? id}</td>
                {GUN_FIELDS.map((f) => (
                  <td key={f.key}>
                    <input
                      type="number"
                      aria-label={`${id} ${f.label}`}
                      step={f.step}
                      min={0}
                      disabled={!editable}
                      value={spec[f.key] ?? ''}
                      onChange={(e) => setField(id, f.key, e.target.value)}
                      title={
                        defaults[id] && spec[f.key] !== defaults[id][f.key]
                          ? `default ${defaults[id][f.key] ?? 'none'}`
                          : undefined
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <button onClick={() => setGuns(defaults)}>Reset to defaults</button>
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending}
            onClick={() => save.mutate({ weapons: guns })}
          >
            Save guns
          </button>
        </div>
      )}
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
