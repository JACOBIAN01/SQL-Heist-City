import { useSection } from '../api/config';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CONSENT_STATEMENTS,
  CONSENT_VERSION,
  QUESTION_USAGES,
  consentIsCurrent,
  type ClassQuestionLink,
  type ClassRecord,
  type QuestionUsage,
} from '@heist/shared';
import {
  useAcceptConsent,
  useLeague,
  useLive,
  useLiveCommand,
  useLockClass,
  useClass,
  useClassQuestions,
  useNewCode,
  useRound,
  useRounds,
  useRoster,
  useBalanceSquads,
  useSaveClassQuestions,
  useSaveSquads,
  useSquads,
  useUpdateClass,
} from '../api/classes';
import { useQuestions } from '../api/questions';
import { useAssessments, useSaveAssessment } from '../api/analytics';
import { ErrorMessage } from '../components/ErrorMessage';
import { useMe } from '../auth/useMe';

const USAGE_LABELS: Record<QuestionUsage, string> = {
  vault: 'Vault locks',
  heal: 'Healing',
  gun: 'Guns',
  ammo: 'Ammo',
};
const BANKS = [1, 2, 3, 4, 5];

const keyOf = (l: ClassQuestionLink) => `${l.questionId}:${l.usage}`;

export function ClassEditorPage() {
  const id = Number(useParams().id);
  const cls = useClass(id);
  if (cls.isPending) return <p className="muted">Loading…</p>;
  if (cls.isError) return <ErrorMessage error={cls.error} />;
  return <ClassEditor key={cls.data.id} record={cls.data} />;
}

function ClassEditor({ record }: { record: ClassRecord }) {
  const update = useUpdateClass(record.id);
  const newCode = useNewCode(record.id);
  const [name, setName] = useState(record.name);
  const [banks, setBanks] = useState(record.banksOpen);
  const [seed, setSeed] = useState(record.citySeed ?? '');
  const [minutes, setMinutes] = useState(record.roundMinutes?.toString() ?? '');
  const [cap, setCap] = useState(record.playerCap);
  const [dialect, setDialect] = useState(record.dialect);
  const [squadMode, setSquadMode] = useState(record.squadMode);
  const [squadSize, setSquadSize] = useState(record.squadSize);
  const packs = useSection('dialects');
  const packNames = Object.entries(
    (packs.data?.current.packs ?? {}) as Record<string, { name?: string }>,
  );

  const save = () =>
    update.mutate({
      name,
      banksOpen: banks,
      citySeed: seed.trim() === '' ? null : seed.trim(),
      roundMinutes: minutes.trim() === '' ? null : Number(minutes),
      playerCap: cap,
      dialect,
      squadMode,
      squadSize,
    });

  return (
    <div className="stack">
      <div className="row">
        <h1>{record.name}</h1>
        <span className="spacer" />
        <Link to={`/classes/${record.id}/learning`}>Learning &amp; profiles</Link>
        <Link to="/classes">← All classes</Link>
      </div>

      <div className="card stack">
        <h2>Join code</h2>
        <p>
          Students type <code className="join-code big">{record.code}</code> to join.
        </p>
        <div className="row">
          <button
            onClick={() =>
              window.confirm('Make a new code? The old one stops working.') && newCode.mutate()
            }
          >
            Make a new code
          </button>
        </div>
        <ErrorMessage error={newCode.error} />
      </div>

      <div className="card stack">
        <h2>Settings</h2>
        <label>
          Class name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <fieldset>
          <legend>Banks open to the class</legend>
          <p className="muted">
            A closed bank stays on the map marked CLOSED. Its vault cannot be worked and the round
            does not wait for it.
          </p>
          <div className="row">
            {BANKS.map((tier) => (
              <label key={tier} className="check">
                <input
                  type="checkbox"
                  checked={banks.includes(tier)}
                  onChange={(e) =>
                    setBanks(
                      e.target.checked ? [...banks, tier].sort() : banks.filter((b) => b !== tier),
                    )
                  }
                />
                Bank {tier}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          SQL dialect the class learns (the game runs SQLite; others get notes in the pop-up)
          <select value={dialect} onChange={(e) => setDialect(e.target.value)}>
            {(packNames.length ? packNames : [['sqlite', { name: 'SQLite' }] as const]).map(
              ([id, pack]) => (
                <option key={id} value={id}>
                  {pack.name ?? id}
                </option>
              ),
            )}
          </select>
        </label>
        <fieldset>
          <legend>Squads</legend>
          <p className="muted">
            Squads of 3 or 4 share their score: cash, kills and vault locks add up. Off plays as
            individuals.
          </p>
          <div className="row">
            <label>
              How squads are formed
              <select
                value={squadMode}
                onChange={(e) => setSquadMode(e.target.value as typeof squadMode)}
              >
                <option value="off">No squads</option>
                <option value="teacher">I choose who is in which</option>
                <option value="self">Students pick their own</option>
                <option value="auto">Balanced by mastery</option>
              </select>
            </label>
            <label>
              Students per squad
              <select value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))}>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          </div>
        </fieldset>
        <label>
          City seed (the same seed gives the same city; leave empty for the default)
          <input value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={64} />
        </label>
        <label>
          Round length in minutes (empty uses the game setting)
          <input
            type="number"
            min={1}
            max={120}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label>
          Most students in the room (60–200)
          <input
            type="number"
            min={60}
            max={200}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
          />
        </label>
        <ErrorMessage error={update.error} />
        <div className="row">
          <span className="spacer" />
          {update.isSuccess && <span className="notice">Saved ✓</span>}
          <button className="primary" disabled={update.isPending} onClick={save}>
            Save settings
          </button>
        </div>
      </div>

      <SchoolTerms record={record} />
      <LiveRoom record={record} />
      <QuestionRelease classId={record.id} />
      <Assessments classId={record.id} />
      {record.squadMode !== 'off' && <Squads classId={record.id} />}
      <League classId={record.id} />
      <Rounds classId={record.id} />
      <Roster classId={record.id} />
    </div>
  );
}

/** Which questions the class gets, for each kind of task. */
function QuestionRelease({ classId }: { classId: number }) {
  const questions = useQuestions({});
  const released = useClassQuestions(classId);
  const save = useSaveClassQuestions(classId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (released.data) setPicked(new Set(released.data.map(keyOf)));
  }, [released.data]);

  const rows = useMemo(
    () =>
      [...(questions.data ?? [])]
        .filter((q) => q.enabled)
        .filter(
          (q) =>
            !filter ||
            q.title.toLowerCase().includes(filter.toLowerCase()) ||
            q.slug.includes(filter.toLowerCase()),
        )
        .sort((a, b) => a.tier - b.tier || a.id - b.id),
    [questions.data, filter],
  );
  const toggle = (questionId: number, usage: QuestionUsage) => {
    const k = keyOf({ questionId, usage });
    const next = new Set(picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setPicked(next);
  };
  const countFor = (usage: QuestionUsage) =>
    [...picked].filter((k) => k.endsWith(`:${usage}`)).length;
  const links: ClassQuestionLink[] = [...picked].map((k) => {
    const [q, usage] = k.split(':');
    return { questionId: Number(q), usage: usage as QuestionUsage };
  });

  return (
    <div className="card stack">
      <h2>Questions for this class</h2>
      <p className="muted">
        The class only ever gets questions released here, for the kind of task ticked. A kind with
        nothing ticked has no questions, so students cannot do it. Can&apos;t find what you need?{' '}
        <Link to="/questions/new">Write a new question</Link>, then come back and tick it.
      </p>
      <div className="row">
        {QUESTION_USAGES.map((u) => (
          <span key={u} className="badge">
            {USAGE_LABELS[u]}: {countFor(u)}
          </span>
        ))}
        <span className="spacer" />
        <input
          aria-label="Filter questions"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Question</th>
              {QUESTION_USAGES.map((u) => (
                <th key={u}>{USAGE_LABELS[u]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.tier}</td>
                <td>
                  {q.title}
                  <div className="muted">{q.slug}</div>
                </td>
                {QUESTION_USAGES.map((u) => (
                  <td key={u}>
                    <input
                      type="checkbox"
                      aria-label={`${q.slug} ${u}`}
                      checked={picked.has(keyOf({ questionId: q.id, usage: u }))}
                      onChange={() => toggle(q.id, u)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorMessage error={save.error ?? released.error ?? questions.error} />
      <div className="row">
        <span className="spacer" />
        {save.isSuccess && <span className="notice">Saved ✓</span>}
        <button className="primary" disabled={save.isPending} onClick={() => save.mutate(links)}>
          Save question set
        </button>
      </div>
    </div>
  );
}

function Roster({ classId }: { classId: number }) {
  const roster = useRoster(classId);
  const command = useLiveCommand(classId);
  const isAdmin = useMe().data?.role === 'admin';
  return (
    <div className="card stack">
      <h2>Students who joined</h2>
      <ErrorMessage error={roster.error ?? command.error} />
      {roster.data?.length === 0 && <p className="muted">Nobody has joined yet.</p>}
      <table>
        <tbody>
          {roster.data?.map((s) => (
            <tr key={s.playerId}>
              <td>
                <Link to={`/classes/${classId}/students/${s.playerId}`}>{s.displayName}</Link>
              </td>
              <td className="muted">{isAdmin ? s.email : ''}</td>
              <td className="muted">{new Date(s.joinedAt).toLocaleString()}</td>
              <td>
                <button
                  onClick={() => {
                    const name = window.prompt('New display name', s.displayName);
                    if (name) command.mutate({ rename: s.playerId, name });
                  }}
                >
                  Rename
                </button>{' '}
                <button
                  className="danger"
                  onClick={() =>
                    window.confirm(`Remove ${s.displayName} from the room?`) &&
                    command.mutate({ kick: s.playerId })
                  }
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The school's terms (Phase 21.3, 21.7): a class cannot start, or take students, until a teacher
 * or administrator ticks every statement, including the plain statement that the game is violent.
 */
function SchoolTerms({ record }: { record: ClassRecord }) {
  const accept = useAcceptConsent(record.id);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  if (consentIsCurrent(record.consent))
    return (
      <div className="card stack">
        <h2>School terms</h2>
        <p>
          <span className="badge">ACCEPTED</span> on{' '}
          {new Date(record.consent?.at ?? '').toLocaleDateString()} (terms version{' '}
          {record.consent?.version}). Students can join and the match can start.
        </p>
        <p className="muted">
          <a href="/legal/privacy.html">Privacy Policy</a> · <a href="/legal/terms.html">Terms</a> ·{' '}
          <a href="/legal/dpa.html">Data Processing Agreement</a>
        </p>
      </div>
    );
  const all = CONSENT_STATEMENTS.every((s) => ticked.has(s.id));
  return (
    <div className="card stack" role="group" aria-label="School terms">
      <h2>School terms</h2>
      <p>
        <span className="badge">NOT ACCEPTED</span> Students cannot join this class and the match
        cannot start until the school accepts the terms. Please read them and tick each one.
      </p>
      <p className="muted">
        <a href="/legal/privacy.html">Privacy Policy</a> · <a href="/legal/terms.html">Terms</a> ·{' '}
        <a href="/legal/dpa.html">Data Processing Agreement</a>
      </p>
      {CONSENT_STATEMENTS.map((s) => (
        <label key={s.id} className="check">
          <input
            type="checkbox"
            checked={ticked.has(s.id)}
            onChange={(e) => {
              const next = new Set(ticked);
              if (e.target.checked) next.add(s.id);
              else next.delete(s.id);
              setTicked(next);
            }}
          />
          {s.text}
        </label>
      ))}
      <ErrorMessage error={accept.error} />
      <div className="row">
        <button
          className="primary"
          disabled={!all || accept.isPending}
          onClick={() => accept.mutate({ version: CONSENT_VERSION, accepted: [...ticked] })}
        >
          Accept for my school
        </button>
      </div>
    </div>
  );
}

/** Start and run the room: the teacher's word begins the match. */
function LiveRoom({ record }: { record: ClassRecord }) {
  const live = useLive(record.id);
  const command = useLiveCommand(record.id);
  const lock = useLockClass(record.id);
  const status = live.data?.status;
  const running = status?.state === 'live';
  return (
    <div className="card stack">
      <h2>Room</h2>
      {live.data && !live.data.connected && (
        <p className="muted">
          The admin cannot reach the game server, so the room cannot be run from here.
        </p>
      )}
      <p>
        {running ? (
          <>
            <span className="badge">LIVE</span> {status?.players ?? 0} of{' '}
            {status?.maxPlayers ?? record.playerCap} students in the match.
          </>
        ) : (
          <>
            <span className="badge">NOT STARTED</span> Students who joined with the code are
            waiting.
          </>
        )}
      </p>
      <div className="row">
        {!running && (
          <button
            className="primary"
            disabled={command.isPending || !consentIsCurrent(record.consent)}
            title={consentIsCurrent(record.consent) ? undefined : 'Accept the school terms first'}
            onClick={() => command.mutate({ action: 'start' })}
          >
            Start the match
          </button>
        )}
        {running && (
          <>
            <button onClick={() => command.mutate({ action: 'end-round' })}>End this round</button>
            <button onClick={() => command.mutate({ action: 'next-round' })}>
              Start next round now
            </button>
            <button
              className="danger"
              onClick={() =>
                window.confirm('Stop the match? Everyone is disconnected.') &&
                command.mutate({ action: 'stop' })
              }
            >
              Stop the match
            </button>
          </>
        )}
        <span className="spacer" />
        <button disabled={lock.isPending} onClick={() => lock.mutate(!record.locked)}>
          {record.locked ? 'Let new students join' : 'Lock the room to new students'}
        </button>
      </div>
      <ErrorMessage error={command.error ?? lock.error ?? live.error} />
    </div>
  );
}

/** Finished rounds, kept after the room closes. */
/** Who is in which squad: the teacher's list, or one balanced by mastery (Phase 27.2). */
function Squads({ classId }: { classId: number }) {
  const squads = useSquads(classId);
  const roster = useRoster(classId);
  const save = useSaveSquads(classId);
  const balance = useBalanceSquads(classId);
  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => setDraft(squads.data?.assignments ?? {}), [squads.data]);
  if (!squads.data) return null;
  const { mode, max, size } = squads.data;
  const counts = new Map<number, number>();
  for (const s of Object.values(draft)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const over = [...counts].filter(([, n]) => n > size).map(([s]) => s);
  return (
    <div className="card stack">
      <h2>Squads</h2>
      {mode === 'self' && (
        <p className="muted">
          Students pick their own squad in the room (up to {size} each). A list here, if you save
          one, is used first.
        </p>
      )}
      <div className="row">
        <button
          type="button"
          onClick={() =>
            window.confirm('Replace the list with one balanced by mastery?') && balance.mutate()
          }
        >
          Balance by mastery
        </button>
        <span className="muted">
          Strong and weak students are spread across{' '}
          {Math.ceil((roster.data?.length ?? 0) / size) || 1} squads.
        </span>
      </div>
      <ErrorMessage error={save.error ?? balance.error} />
      {over.length > 0 && (
        <p className="error">
          Squad {over.join(', ')} has more than {size} students.
        </p>
      )}
      <table aria-label="Squad list">
        <thead>
          <tr>
            <th>Student</th>
            <th>Squad</th>
          </tr>
        </thead>
        <tbody>
          {roster.data?.map((s) => (
            <tr key={s.playerId}>
              <td>{s.displayName}</td>
              <td>
                <select
                  aria-label={`Squad for ${s.displayName}`}
                  value={draft[String(s.playerId)] ?? 0}
                  onChange={(e) => {
                    const next = { ...draft };
                    if (Number(e.target.value) === 0) delete next[String(s.playerId)];
                    else next[String(s.playerId)] = Number(e.target.value);
                    setDraft(next);
                  }}
                >
                  <option value={0}>None</option>
                  {Array.from({ length: max }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Squad {i + 1}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <span className="spacer" />
        {save.isSuccess && <span className="notice">Saved ✓</span>}
        <button
          className="primary"
          disabled={over.length > 0 || save.isPending}
          onClick={() => save.mutate(draft)}
        >
          Save squads
        </button>
      </div>
    </div>
  );
}

/** The weekly league: marks earned count for more than cash, which is capped (docs/gameplay.md). */
function League({ classId }: { classId: number }) {
  const [week, setWeek] = useState<string | undefined>();
  const league = useLeague(classId, week);
  const shift = (weeks: number) => {
    const current = league.data?.week.start;
    if (!current) return;
    setWeek(new Date(Date.parse(current) + weeks * 7 * 86_400_000).toISOString().slice(0, 10));
  };
  return (
    <div className="card stack">
      <h2>Weekly league</h2>
      <div className="row">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous week">
          ←
        </button>
        <span>Week of {league.data?.week.start ?? '…'}</span>
        <button type="button" onClick={() => shift(1)} aria-label="Next week">
          →
        </button>
      </div>
      <ErrorMessage error={league.error} />
      {league.data?.rows.length === 0 && (
        <p className="muted">Nobody played or answered this week.</p>
      )}
      {league.data && league.data.rows.length > 0 && (
        <table aria-label="Weekly league">
          <thead>
            <tr>
              <th>#</th>
              <th>Student</th>
              <th>Points</th>
              <th>Learning</th>
              <th>Cash</th>
              <th>Rounds</th>
            </tr>
          </thead>
          <tbody>
            {league.data.rows.map((r) => (
              <tr key={r.name + r.rank}>
                <td className="num">{r.rank}</td>
                <td>{r.name}</td>
                <td className="num">{r.points}</td>
                <td className="num">
                  {r.learningPoints}{' '}
                  <span className="muted">
                    ({r.earned}/{r.available} marks)
                  </span>
                </td>
                <td className="num">
                  {r.cashPoints} <span className="muted">(${r.banked.toLocaleString()})</span>
                </td>
                <td className="num">{r.rounds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Rounds({ classId }: { classId: number }) {
  const rounds = useRounds(classId);
  const [open, setOpen] = useState<number | undefined>();
  const detail = useRound(classId, open);
  return (
    <div className="card stack">
      <h2>Finished rounds</h2>
      <ErrorMessage error={rounds.error ?? detail.error} />
      {rounds.data?.length === 0 && <p className="muted">No round has finished yet.</p>}
      <table>
        <tbody>
          {rounds.data?.map((r) => (
            <tr
              key={r.id}
              className="clickable"
              onClick={() => setOpen(open === r.id ? undefined : r.id)}
            >
              <td>Round {r.number}</td>
              <td className="muted">{new Date(r.endedAt).toLocaleString()}</td>
              <td className="num">{r.players} students</td>
              <td>
                {r.winner
                  ? `Won by ${r.winner.name} ($${r.winner.banked.toLocaleString()})`
                  : 'No winner'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.data && open !== undefined && (
        <table aria-label="Round results">
          <thead>
            <tr>
              <th>#</th>
              <th>Student</th>
              <th>Banked</th>
              <th>Kills</th>
              <th>Deaths</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.standings.map((s) => (
              <tr key={s.rank}>
                <td className="num">{s.rank}</td>
                <td>{s.name}</td>
                <td className="num">${s.banked.toLocaleString()}</td>
                <td className="num">{s.kills}</td>
                <td className="num">{s.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A short fixed test before (pre) and after (post) a unit: the gain shows on the Learning page. */
function Assessments({ classId }: { classId: number }) {
  const released = useClassQuestions(classId);
  const current = useAssessments(classId);
  const save = useSaveAssessment(classId);
  const [picked, setPicked] = useState<Record<'pre' | 'post', Set<number>>>({
    pre: new Set(),
    post: new Set(),
  });
  const [open, setOpen] = useState<Record<'pre' | 'post', boolean>>({ pre: false, post: false });
  useEffect(() => {
    if (!current.data) return;
    setPicked({
      pre: new Set(current.data.pre?.questionIds ?? []),
      post: new Set(current.data.post?.questionIds ?? []),
    });
    setOpen({ pre: current.data.pre?.open ?? false, post: current.data.post?.open ?? false });
  }, [current.data]);
  const questions = [...new Map((released.data ?? []).map((l) => [l.questionId, l])).values()];
  const toggle = (kind: 'pre' | 'post', id: number) => {
    const next = new Set(picked[kind]);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked({ ...picked, [kind]: next });
  };
  return (
    <div className="card stack">
      <h2>Pre-test and post-test</h2>
      <p className="muted">
        A short test before and after a unit: the same questions for everyone, no hints, one go at
        each. The Learning page shows the gain. Choose from this class&apos;s released questions.
      </p>
      {questions.length === 0 && (
        <p className="muted">Release some questions to the class first.</p>
      )}
      {(['pre', 'post'] as const).map((kind) => (
        <fieldset key={kind}>
          <legend>{kind === 'pre' ? 'Pre-test' : 'Post-test'}</legend>
          {questions.map((q) => (
            <label key={q.questionId} className="check">
              <input
                type="checkbox"
                aria-label={`${kind} ${q.slug ?? q.questionId}`}
                checked={picked[kind].has(q.questionId)}
                onChange={() => toggle(kind, q.questionId)}
              />
              T{q.tier} · {q.title}
            </label>
          ))}
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                aria-label={`${kind} open`}
                checked={open[kind]}
                onChange={(e) => setOpen({ ...open, [kind]: e.target.checked })}
              />
              Open to students
            </label>
            <span className="spacer" />
            <button
              className="primary"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ kind, questionIds: [...picked[kind]], open: open[kind] })
              }
            >
              Save {kind === 'pre' ? 'pre-test' : 'post-test'}
            </button>
          </div>
        </fieldset>
      ))}
      <ErrorMessage error={save.error ?? current.error} />
      {save.isSuccess && <span className="notice">Saved ✓</span>}
    </div>
  );
}
