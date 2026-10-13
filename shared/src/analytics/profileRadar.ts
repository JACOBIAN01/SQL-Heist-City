import {
  BLOOM_LEVELS,
  BLOOM_NAMES,
  RCSBE_DIMENSIONS,
  RCSBE_NAMES,
  type RcsbeDimension,
} from '../questions/analytics';
import type { AxisScore, Lens } from './profile';
import type { RadarAxis } from './radar';

/** The axes of a lens, with full names (the letter and the name are always shown together). */
export function lensAxes(lens: Lens): RadarAxis[] {
  return lens === 'rcsbe'
    ? RCSBE_DIMENSIONS.map((d) => ({ key: d, label: `${d} · ${RCSBE_NAMES[d]}` }))
    : BLOOM_LEVELS.map((b) => ({ key: b, label: BLOOM_NAMES[b] }));
}

/** One value per axis, null where there is not enough data. */
export const scoreValues = (scores: readonly AxisScore[]): (number | null)[] =>
  scores.map((s) => s.score);

/** What the student is told about their weakest axis. */
export function focusText(lens: Lens, dimension: string): string {
  const name =
    lens === 'rcsbe'
      ? RCSBE_NAMES[dimension as RcsbeDimension]
      : (BLOOM_NAMES as Record<string, string>)[dimension];
  return `Next: practise ${name ?? dimension}.`;
}

/** An axis as it reads in a list: "Comprehend 62% (5 questions)" or "Comprehend: not enough data yet". */
export function axisLine(lens: Lens, s: AxisScore): string {
  const name =
    lens === 'rcsbe'
      ? RCSBE_NAMES[s.dimension as RcsbeDimension]
      : (BLOOM_NAMES as Record<string, string>)[s.dimension];
  const label = name ?? s.dimension;
  if (s.score === null)
    return s.items === 0 ? `${label}: no questions yet` : `${label}: not enough data yet`;
  return `${label} ${Math.round(s.score)}% (${s.items} question${s.items === 1 ? '' : 's'}, ${s.earned}/${s.available} marks)`;
}
