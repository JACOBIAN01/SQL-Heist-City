import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  QUESTION_USAGES,
  type ClassQuestionLink,
  type ClassRecord,
  type QuestionUsage,
} from '@heist/shared';
import {
  useLive,
  useLiveCommand,
  useLockClass,
  useClass,
  useClassQuestions,
  useNewCode,
  useRound,
  useRounds,
  useRoster,
  useSaveClassQuestions,
  useUpdateClass,
} from '../api/classes';
import { useQuestions } from '../api/questions';
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

  const save = () =>
    update.mutate({
      name,
      banksOpen: banks,
      citySeed: seed.trim() === '' ? null : seed.trim(),
      roundMinutes: minutes.trim() === '' ? null : Number(minutes),
      playerCap: cap,
    });

  return (
    <div className="stack">
      <div className="row">
        <h1>{record.name}</h1>
        <span className="spacer" />
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

      <LiveRoom record={record} />
      <QuestionRelease classId={record.id} />
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
              <td>{s.displayName}</td>
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
            disabled={command.isPending}
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
