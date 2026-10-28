import { useEffect, useMemo, useRef, useState } from 'react';
import { replayPositions, type RoundReplay } from '@heist/shared';

const SIZE = 420;
/** How much faster than real time a replay plays. */
const SPEED = 12;

/**
 * A round, seen from above: dots for the students moving along the recorded tracks, a slider to
 * scrub, and the moments that mattered beside it. Plays at twelve times speed.
 */
export function ReplayPlayer({ replay }: { replay: RoundReplay }) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const zs: number[] = [];
    for (const t of replay.tracks) t.points.forEach((v, i) => (i % 2 === 0 ? xs : zs).push(v));
    const min = (a: number[]) => (a.length ? Math.min(...a) : 0);
    const max = (a: number[]) => (a.length ? Math.max(...a) : 1);
    return {
      x0: min(xs),
      z0: min(zs),
      w: Math.max(1, max(xs) - min(xs)),
      h: Math.max(1, max(zs) - min(zs)),
    };
  }, [replay]);

  const here = useMemo(() => replayPositions(replay, at), [replay, at]);
  const recent = replay.events.filter((e) => e.at <= at && e.at > at - 60).slice(-8);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setAt((s) => {
        if (s + SPEED / 10 >= replay.seconds) {
          setPlaying(false);
          return replay.seconds;
        }
        return s + SPEED / 10;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, replay.seconds]);

  useEffect(() => {
    const ctx = canvas.current?.getContext?.('2d');
    if (!ctx) return;
    const scale = (SIZE - 20) / Math.max(bounds.w, bounds.h);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#e44';
    for (const p of here) {
      ctx.beginPath();
      ctx.arc(10 + (p.x - bounds.x0) * scale, 10 + (p.z - bounds.z0) * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [here, bounds]);

  return (
    <div className="stack" aria-label="Round replay">
      <canvas
        ref={canvas}
        width={SIZE}
        height={SIZE}
        style={{ background: '#222', maxWidth: '100%' }}
      />
      <div className="row">
        <button type="button" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          aria-label="Time in the round"
          min={0}
          max={replay.seconds}
          value={Math.round(at)}
          onChange={(e) => setAt(Number(e.target.value))}
        />
        <span className="muted">
          {Math.floor(at / 60)}:{String(Math.floor(at % 60)).padStart(2, '0')} /{' '}
          {Math.floor(replay.seconds / 60)}:{String(replay.seconds % 60).padStart(2, '0')}
        </span>
      </div>
      <p className="muted">{here.length} students on the map</p>
      <ul aria-label="What just happened">
        {recent.map((e, i) => (
          <li key={i}>
            {Math.floor(e.at / 60)}:{String(e.at % 60).padStart(2, '0')} · {describe(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function describe(e: RoundReplay['events'][number]): string {
  switch (e.kind) {
    case 'kill':
      return `${e.who} put ${e.other ?? 'someone'} down`;
    case 'lock':
      return `${e.who} cracked a lock at ${e.text ?? 'a bank'}`;
    case 'vault':
      return `${e.who} opened the vault at ${e.text ?? 'a bank'}`;
    case 'banked':
      return `${e.who} banked $${Number(e.text ?? 0).toLocaleString()}`;
    case 'failed':
      return `${e.who} lost the take at ${e.text ?? 'a bank'}`;
    case 'solved':
      return `${e.who} solved ${e.text ?? 'a question'}`;
    case 'joined':
      return `${e.who} joined`;
  }
}
