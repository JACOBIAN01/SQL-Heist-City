import { useEffect, useState } from 'react';
import {
  TASK_KINDS,
  type ChallengeSettings,
  type CombatSettings,
  type RewardTierEntry,
  type TaskKind,
  type TutorialSettings,
  type WeaponSpec,
} from '@heist/shared';
import {
  useChallengeSettings,
  useCombatSettings,
  useRewardMap,
  useSaveChallengeSettings,
  useSaveCombatSettings,
  useSaveRewardMap,
  useSaveTutorialSettings,
  useTutorialSettings,
} from '../api/config';
import { useQuestions } from '../api/questions';
import { useMe } from '../auth/useMe';
import { ErrorMessage } from '../components/ErrorMessage';
import { NameRulesCard } from './NameRulesCard';
import { RewardIconsCard } from './RewardIconsCard';
import { REWARD_LABELS } from './rewardLabels';
import { SectionCard } from './SectionCard';

type NumericKey = Exclude<keyof ChallengeSettings, 'hintCostMode' | 'taskKinds'>;

const FIELDS: { key: NumericKey; label: string; unit: string }[] = [
  { key: 'lockoutSec', label: 'Lockout after a wrong answer', unit: 's' },
  { key: 'ttlSec', label: 'Challenge expires after', unit: 's' },
  { key: 'runCooldownMs', label: 'Min gap between "Run" presses', unit: 'ms' },
  { key: 'submitCooldownMs', label: 'Min gap between "Submit" presses', unit: 'ms' },
  { key: 'requestCooldownMs', label: 'Min gap between new challenges', unit: 'ms' },
  {
    key: 'freeHintSteps',
    label: 'Free hint steps (0 none, 1 nudge, 2 nudge and card)',
    unit: 'steps',
  },
  { key: 'sampleRows', label: 'Sample rows shown per table', unit: 'rows' },
  { key: 'exampleRows', label: 'Worked example: rows per table at first', unit: 'rows' },
  { key: 'exampleTries', label: 'Worked example: small tries before full size', unit: 'tries' },
  { key: 'exampleShownRows', label: 'Worked example: rows shown', unit: 'rows' },
];

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
      <RewardIconsCard editable={isAdmin} />
      <NameRulesCard editable={isAdmin} />
      <GunsCard editable={isAdmin} />
      <TutorialCard editable={isAdmin} />
      <SectionCard
        name="heist"
        title="Heist rules"
        note="Locks, loot, bounties, round length, banking and carrying. Applies in every match from its next round."
        editable={isAdmin}
      />
      <SectionCard
        name="vehicles"
        title="Vehicles"
        note="Car speed, handling and mass, and how hard a car hits a person. Applies from the next round; players get the new numbers at once."
        editable={isAdmin}
      />
      <SectionCard
        name="atmosphere"
        title="Day and night"
        note="How long a day lasts and the hour a match starts. Applies from the next round."
        editable={isAdmin}
      />
      <SectionCard
        name="analytics"
        title="Learning measures"
        note="Marks per tier, the hint penalty, when an unfinished question counts, and how much evidence a dimension needs before it is scored. See docs/RCBSE.md."
        editable={isAdmin}
      />
      <SectionCard
        name="privacy"
        title="Privacy"
        note="The youngest age allowed to play (asked once; the birth year is not kept) and how long data is kept before it is deleted: unused student accounts, archived classes, open briefs. 0 keeps for ever. See docs/privacy.md."
        editable={isAdmin}
      />
      <SectionCard
        name="modes"
        title="Game modes"
        note="The modes a class can pick: each names the heist settings it changes (round length, locks, overtime…), how many banks are open, and whether the room plays a heist or SQL duels. Keep a mode called classic."
        editable={isAdmin}
      />
      <SectionCard
        name="cityDb"
        title="City database"
        note="The live city tables students query for intel, camera hacks and door control: the requests (their tier, words and the answer, which is never sent to students), how long intel lasts by tier, the range, the cooldowns and the camera time. See docs/gameplay.md."
        editable={isAdmin}
      />
      <SectionCard
        name="story"
        title="Story"
        note="The crew's story: a fixer and a chain of three steps for each bank, the scenes that play when a chain starts and ends, the short lines the fixers say, and the line shown above each question. See docs/story.md."
        editable={isAdmin}
      />
      <SectionCard
        name="progression"
        title="XP and ranks"
        note="XP for a solved question by tier, the first-try and hint adjustments, XP for rounds (kills, cash, the podium, with a cap so fighting cannot outrun learning), and the rank names with the XP each needs."
        editable={isAdmin}
      />
      <SectionCard
        name="dialects"
        title="Dialect packs"
        note="How PostgreSQL and MySQL differ from SQLite (the game's engine), one entry per quirk. A class picks a pack; the pop-up shows the entries its question touches and the rest as a cheat-sheet."
        editable={isAdmin}
      />
      <SectionCard
        name="city"
        title="City"
        note="How the city is generated. A new city appears in matches created after the change; running matches keep theirs."
        editable={isAdmin}
      />
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
      <TaskKindsTable
        editable={editable}
        value={form.taskKinds}
        onChange={(taskKinds) => setForm({ ...form, taskKinds })}
      />
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

const TUTORIAL_TASKS: { key: keyof TutorialSettings['questions']; label: string }[] = [
  { key: 'heal', label: 'Heal task' },
  { key: 'gun', label: 'Gun task' },
  { key: 'vault', label: 'Vault lock' },
];

/** The question each tutorial task always asks (the same for every player, solution free). */
function TutorialCard({ editable }: { editable: boolean }) {
  const settings = useTutorialSettings();
  const questions = useQuestions({ enabled: true });
  const save = useSaveTutorialSettings();
  const [picked, setPicked] = useState<TutorialSettings['questions'] | null>(null);
  useEffect(() => {
    if (settings.data) setPicked(settings.data.current.questions);
  }, [settings.data]);

  if (!picked || !settings.data) return <ErrorMessage error={settings.error} />;
  const list = [...(questions.data ?? [])].sort((a, b) => a.tier - b.tier || a.id - b.id);
  return (
    <div className="card stack">
      <h2>Tutorial questions</h2>
      <p className="muted">
        Each tutorial task always asks this question, with the same tables for every player, and its
        solution is free. New tutorials use a change.
      </p>
      {TUTORIAL_TASKS.map((t) => (
        <label key={t.key}>
          {t.label}
          <select
            disabled={!editable}
            value={picked[t.key]}
            onChange={(e) => setPicked({ ...picked, [t.key]: e.target.value })}
          >
            {!list.some((q) => q.slug === picked[t.key]) && (
              <option value={picked[t.key]}>{picked[t.key]} (not found)</option>
            )}
            {list.map((q) => (
              <option key={q.id} value={q.slug}>
                T{q.tier} · {q.title} ({q.slug})
              </option>
            ))}
          </select>
        </label>
      ))}
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <button onClick={() => setPicked(settings.data.defaults.questions)}>
            Reset to defaults
          </button>
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending}
            onClick={() => save.mutate({ questions: picked })}
          >
            Save tutorial
          </button>
        </div>
      )}
    </div>
  );
}

/** Which kinds of task each reward family may ask; `*` is every family not listed. */
function TaskKindsTable({
  editable,
  value,
  onChange,
}: {
  editable: boolean;
  value: ChallengeSettings['taskKinds'];
  onChange: (next: ChallengeSettings['taskKinds']) => void;
}) {
  const toggle = (family: string, kind: TaskKind) => {
    const now = new Set(value[family] ?? []);
    if (now.has(kind)) now.delete(kind);
    else now.add(kind);
    // A family needs at least one kind.
    if (now.size > 0) onChange({ ...value, [family]: TASK_KINDS.filter((k) => now.has(k)) });
  };
  return (
    <fieldset>
      <legend>Kinds of task per reward (* = any other reward)</legend>
      <table className="table">
        <thead>
          <tr>
            <th>Reward</th>
            {TASK_KINDS.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(value).map((family) => (
            <tr key={family}>
              <td>
                <code>{family}</code>
              </td>
              {TASK_KINDS.map((k) => (
                <td key={k}>
                  <input
                    type="checkbox"
                    aria-label={`${family}: ${k}`}
                    disabled={!editable}
                    checked={value[family]?.includes(k) ?? false}
                    onChange={() => toggle(family, k)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}
