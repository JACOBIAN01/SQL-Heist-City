import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  RCSBE_NAMES,
  lensAxes,
  scoreValues,
  type AxisScore,
  type Lens,
  type ProfileScopeView,
  type RcsbeDimension,
} from '@heist/shared';
import { useClassAnalytics, useItemAnalysis, type Spread } from '../api/analytics';
import { Radar } from '../components/Radar';
import { ErrorMessage } from '../components/ErrorMessage';

const TABS = ['Profile', 'Students', 'Spread', 'Paper', 'Questions'] as const;
type Tab = (typeof TABS)[number];

const FLAG_TEXT: Record<string, string> = {
  too_hard: 'Very few solve it',
  too_easy: 'Almost everyone solves it',
  slow: 'Takes a long time',
  weak_separation: 'Does not separate strong from weak',
  few_attempts: 'Too few attempts to judge',
};

/** The class's learning: live profile, the students, spread, the paper against the target, and per-question quality. */
export function ClassLearningPage() {
  const id = Number(useParams().id);
  const data = useClassAnalytics(id);
  const [tab, setTab] = useState<Tab>('Profile');
  if (data.isPending) return <p className="muted">Loading…</p>;
  if (data.isError) return <ErrorMessage error={data.error} />;
  const a = data.data;
  return (
    <div className="stack">
      <div className="row">
        <h1>Learning</h1>
        <span className="spacer" />
        <a href={`/api/classes/${id}/export.csv`}>Download profiles (CSV)</a>
        <Link to={`/classes/${id}`}>← Class</Link>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Profile' && (
        <div className="grid-2">
          <ProfileCard title="Class RCSBE profile" lens="rcsbe" view={a.class} target={a.target} />
          <ProfileCard title="Class Bloom profile" lens="bloom" view={a.class} />
        </div>
      )}
      {tab === 'Students' && (
        <div className="stack">
          <p className="muted">
            Students with the weakest dimension first. Updates while a match is running.
          </p>
          <div className="mini-grid">
            {a.students.length === 0 && <p className="muted">Nobody has joined yet.</p>}
            {a.students.map((s) => (
              <Link
                key={s.playerId}
                to={`/classes/${id}/students/${s.playerId}`}
                className="mini card"
              >
                <strong>{s.name}</strong>
                <Radar
                  title={`${s.name}: RCSBE profile`}
                  axes={lensAxes('rcsbe').map((x) => ({ ...x, label: x.key }))}
                  layers={[{ id: 'student', kind: 'fill', values: scoreValues(s.rcsbe) }]}
                  size={150}
                />
                <Weakest scores={s.rcsbe} />
              </Link>
            ))}
          </div>
        </div>
      )}
      {tab === 'Spread' && (
        <div className="stack">
          <p className="muted">
            Is a low score one student or the whole class? Median and the middle half of students on
            each dimension.
          </p>
          <SpreadTable
            title="RCSBE"
            rows={a.spread.rcsbe}
            name={(d) => `${d} · ${RCSBE_NAMES[d as RcsbeDimension]}`}
          />
          <SpreadTable title="Bloom" rows={a.spread.bloom} name={(d) => d} />
        </div>
      )}
      {tab === 'Paper' && (
        <div className="card stack">
          <h2>Is the paper balanced?</h2>
          <p className="muted">
            The share of marks in the {a.paper.questions} questions released to this class, against
            the target profile.
          </p>
          {a.paper.problems.length === 0 ? (
            <p className="notice">The question set matches the target.</p>
          ) : (
            <ul>
              {a.paper.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <Radar
            title="Question set shape against the target"
            axes={lensAxes('rcsbe')}
            layers={[
              {
                id: 'Question set',
                kind: 'fill',
                values: a.paper.rows.map((r) => Math.round(r.actual)),
              },
              {
                id: 'Target',
                kind: 'outline',
                dashed: true,
                values: a.paper.rows.map((r) => r.target),
              },
            ]}
          />
          <p className="muted">Filled: the class&apos;s questions. Dashed: the target.</p>
        </div>
      )}
      {tab === 'Questions' && <Questions classId={id} />}
    </div>
  );
}

function Weakest({ scores }: { scores: AxisScore[] }) {
  const known = scores.filter((s) => s.score !== null);
  if (known.length === 0) return <span className="muted">no data yet</span>;
  const lowest = known.reduce((m, s) => ((s.score as number) < (m.score as number) ? s : m));
  return (
    <span className="muted">
      weakest: {RCSBE_NAMES[lowest.dimension as RcsbeDimension]}{' '}
      {Math.round(lowest.score as number)}%
    </span>
  );
}

export function ProfileCard({
  title,
  lens,
  view,
  target,
  compare,
}: {
  title: string;
  lens: Lens;
  view: ProfileScopeView;
  target?: Record<RcsbeDimension, number> | undefined;
  compare?: ProfileScopeView | undefined;
}) {
  const layers = [
    { id: 'Profile', kind: 'fill' as const, values: scoreValues(view[lens]) },
    ...(compare
      ? [
          {
            id: 'Class',
            kind: 'outline' as const,
            dashed: true,
            values: scoreValues(compare[lens]),
          },
        ]
      : []),
    ...(target && lens === 'rcsbe'
      ? [
          {
            id: 'Target',
            kind: 'outline' as const,
            dashed: true,
            values: Object.values(target) as number[],
          },
        ]
      : []),
  ];
  return (
    <div className="card stack">
      <h2>{title}</h2>
      <Radar title={title} axes={lensAxes(lens)} layers={layers} />
      <ul className="muted">
        {view[lens].map((s) => (
          <li key={s.dimension}>
            {s.dimension}:{' '}
            {s.score === null
              ? s.items === 0
                ? 'no questions yet'
                : 'not enough data yet'
              : `${Math.round(s.score)}% (${s.items} questions, ${s.earned}/${s.available} marks)`}
          </li>
        ))}
      </ul>
      {(compare || (target && lens === 'rcsbe')) && (
        <p className="muted">
          Filled: this profile.{compare ? ' Dashed: the class.' : ''}
          {target && lens === 'rcsbe' ? ' Dashed: the target.' : ''}
        </p>
      )}
    </div>
  );
}

function SpreadTable({
  title,
  rows,
  name,
}: {
  title: string;
  rows: Spread[];
  name: (d: string) => string;
}) {
  const fmt = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`);
  return (
    <div className="card">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Students scored</th>
            <th>Lowest</th>
            <th>Quarter</th>
            <th>Median</th>
            <th>Three quarters</th>
            <th>Highest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dimension}>
              <td>{name(r.dimension)}</td>
              <td className="num">{r.students}</td>
              <td className="num">{fmt(r.min)}</td>
              <td className="num">{fmt(r.q1)}</td>
              <td className="num">{fmt(r.median)}</td>
              <td className="num">{fmt(r.q3)}</td>
              <td className="num">{fmt(r.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Questions({ classId }: { classId: number }) {
  const items = useItemAnalysis(classId);
  return (
    <div className="card stack">
      <h2>Questions as the class answered them</h2>
      <ErrorMessage error={items.error} />
      {items.data?.length === 0 && <p className="muted">No question has been answered yet.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Tag</th>
              <th>Attempts</th>
              <th>Solved</th>
              <th>Wrong first</th>
              <th>Median time</th>
              <th title="Top third's solve rate minus the bottom third's">Separates</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.map((q) => (
              <tr key={q.questionId}>
                <td>{q.title}</td>
                <td>{q.rcsbe}</td>
                <td className="num">{q.attempts}</td>
                <td className="num">{Math.round(q.solveRate * 100)}%</td>
                <td className="num">{Math.round(q.wrongRate * 100)}%</td>
                <td className="num">{q.medianSeconds === null ? '–' : `${q.medianSeconds} s`}</td>
                <td className="num">{q.discrimination === null ? '–' : q.discrimination}</td>
                <td>{q.flags.map((f) => FLAG_TEXT[f] ?? f).join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a href={`/api/classes/${classId}/export.csv?kind=items`}>Download (CSV)</a>
    </div>
  );
}
