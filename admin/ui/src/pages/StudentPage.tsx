import { Link, useParams } from 'react-router';
import { RCSBE_NAMES, lensAxes, scoreValues, type RcsbeDimension } from '@heist/shared';
import { useStudentAnalytics } from '../api/analytics';
import { Radar } from '../components/Radar';
import { ErrorMessage } from '../components/ErrorMessage';
import { ProfileCard } from './ClassLearningPage';

/** One student in a class: profile over the class and the target, trend, topics and where to practise. */
export function StudentPage() {
  const params = useParams();
  const classId = Number(params.id);
  const playerId = Number(params.playerId);
  const s = useStudentAnalytics(classId, playerId);
  if (s.isPending) return <p className="muted">Loading…</p>;
  if (s.isError) return <ErrorMessage error={s.error} />;
  const d = s.data;
  return (
    <div className="stack">
      <div className="row">
        <h1>{d.player.name}</h1>
        <span className="spacer" />
        <Link to={`/classes/${classId}/learning`}>← Class learning</Link>
      </div>
      {d.remediation ? (
        <p className="notice">
          Next to work on: <strong>{RCSBE_NAMES[d.remediation.dimension as RcsbeDimension]}</strong>{' '}
          ({Math.round(d.remediation.score ?? 0)}% over {d.remediation.items} questions).
        </p>
      ) : (
        <p className="muted">Not enough answered questions yet to say where to practise.</p>
      )}
      <div className="grid-2">
        <ProfileCard
          title="RCSBE profile"
          lens="rcsbe"
          view={d.profile}
          compare={d.classProfile}
          target={d.target}
        />
        <ProfileCard title="Bloom profile" lens="bloom" view={d.profile} compare={d.classProfile} />
      </div>
      <div className="card stack">
        <h2>Round by round</h2>
        {d.trend.length === 0 && <p className="muted">No round recorded yet.</p>}
        <div className="mini-grid">
          {d.trend.map((t) => (
            <div key={t.round} className="mini">
              <strong>Round {t.round}</strong>
              <Radar
                title={`Round ${t.round}`}
                axes={lensAxes('rcsbe').map((x) => ({ ...x, label: x.key }))}
                layers={[{ id: 'round', kind: 'fill', values: scoreValues(t.rcsbe) }]}
                size={150}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="card stack">
        <h2>Topics</h2>
        {d.weakestTopics.length > 0 && (
          <p>
            Weakest:{' '}
            {d.weakestTopics.map((t) => `${t.topic} (${Math.round(t.score ?? 0)}%)`).join(', ')}
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Topic</th>
              <th>Questions</th>
              <th>Solved</th>
              <th>Marks</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {d.topics.map((t) => (
              <tr key={t.topic}>
                <td>{t.topic}</td>
                <td className="num">{t.items}</td>
                <td className="num">{t.solved}</td>
                <td className="num">
                  {t.earned}/{t.available}
                </td>
                <td className="num">
                  {t.score === null ? 'not enough data' : `${Math.round(t.score)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
