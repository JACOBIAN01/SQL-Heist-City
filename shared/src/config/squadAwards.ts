import type { SquadStandingView } from '../net/heistMessages';

/** The awards squads can win at the end of a round (Phase 27.5). */
export const SQUAD_AWARD_IDS = ['top_haul', 'lock_breakers', 'wolfpack', 'brain_trust'] as const;
export type SquadAwardId = (typeof SQUAD_AWARD_IDS)[number];

export interface SquadAwardInfo {
  readonly title: string;
  readonly for: string;
  readonly unit: 'money' | 'count';
  /** What the award counts, from a squad's score line. */
  readonly of: (s: SquadStandingView) => number;
}

export const SQUAD_AWARDS: Readonly<Record<SquadAwardId, SquadAwardInfo>> = {
  top_haul: { title: 'Top Haul', for: 'most cash banked', unit: 'money', of: (s) => s.banked },
  lock_breakers: {
    title: 'Lock Breakers',
    for: 'most vault locks opened',
    unit: 'count',
    of: (s) => s.locks,
  },
  wolfpack: { title: 'Wolfpack', for: 'most kills', unit: 'count', of: (s) => s.kills },
  brain_trust: {
    title: 'Brain Trust',
    for: 'most SQL tasks solved',
    unit: 'count',
    of: (s) => s.solves,
  },
};

export interface SquadAwardView {
  readonly id: SquadAwardId;
  readonly squad: number;
  readonly name: string;
  readonly value: number;
}

/**
 * Who won each squad award. A squad must have scored on it (above zero); a tie goes to the squad
 * with the lower number so the result is always the same, and one squad may win several.
 */
export function squadAwards(table: readonly SquadStandingView[]): SquadAwardView[] {
  const out: SquadAwardView[] = [];
  for (const id of SQUAD_AWARD_IDS) {
    const info = SQUAD_AWARDS[id];
    let best: SquadStandingView | undefined;
    for (const s of table)
      if (
        info.of(s) > 0 &&
        (!best ||
          info.of(s) > info.of(best) ||
          (info.of(s) === info.of(best) && s.squad < best.squad))
      )
        best = s;
    if (best) out.push({ id, squad: best.squad, name: best.name, value: info.of(best) });
  }
  return out;
}
