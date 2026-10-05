import type { AwardId, AwardView } from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvent, HeistEvents } from './HeistEvents';

/** What one event is worth to one award: a player, a number, and how it adds up. */
interface Score {
  readonly player: Player;
  readonly value: number;
  /** `sum` adds to the player's total; `best` keeps their best single value. */
  readonly combine: 'sum' | 'best';
}

/**
 * One award: which events count for it and whether low numbers win.
 * Pattern: Strategy (one rule per award) — Why: each award reads a different
 * event; a new award is one more rule, and the tally and tie-breaking around
 * them stay the same.
 */
interface AwardRule {
  readonly id: AwardId;
  /** Lower wins (times); otherwise higher wins. */
  readonly lowWins?: boolean;
  score(event: HeistEvent): Score | undefined;
}

const RULES: readonly AwardRule[] = [
  {
    id: 'safecracker',
    score: (e) =>
      e.type === 'lock_opened' && e.player
        ? { player: e.player, value: 1, combine: 'sum' }
        : undefined,
  },
  {
    id: 'quick_draw',
    lowWins: true,
    score: (e) =>
      e.type === 'task_solved' && e.seconds !== undefined
        ? { player: e.player, value: Math.round(e.seconds * 10) / 10, combine: 'best' }
        : undefined,
  },
  {
    id: 'sql_brain',
    score: (e) =>
      e.type === 'task_solved' ? { player: e.player, value: 1, combine: 'sum' } : undefined,
  },
  {
    id: 'top_gun',
    score: (e) => (e.type === 'kill' ? { player: e.killer, value: 1, combine: 'sum' } : undefined),
  },
  {
    id: 'bounty_hunter',
    score: (e) =>
      e.type === 'bounty_claimed'
        ? { player: e.killer, value: e.reward, combine: 'sum' }
        : undefined,
  },
  {
    id: 'big_haul',
    score: (e) =>
      e.type === 'banked' ? { player: e.player, value: e.amount, combine: 'best' } : undefined,
  },
];

/** A player's standing for one award: their number, and when they reached it (ties go to the first). */
interface Tally {
  value: number;
  at: number;
}

/**
 * The round's awards. Listens to the heist events, keeps each player's tally
 * per award, and at the end of the round names the best player for each one
 * nobody left empty. Players who left are passed over.
 */
export class RoundAwards {
  private readonly tallies = new Map<AwardId, Map<number, Tally>>();
  /** Orders events, so a tie goes to whoever got there first. */
  private seq = 0;

  constructor(events: HeistEvents) {
    events.subscribe((event) => this.observe(event));
  }

  /** A new round: everyone starts from nothing. */
  reset(): void {
    this.tallies.clear();
  }

  /** The awards as they stand, with names from the players still here. */
  results(playerOf: (id: number) => Player | undefined): AwardView[] {
    const out: AwardView[] = [];
    for (const rule of RULES) {
      let best: { id: number; tally: Tally; player: Player } | undefined;
      for (const [id, tally] of this.tallies.get(rule.id) ?? []) {
        const player = playerOf(id);
        if (!player || (tally.value <= 0 && !rule.lowWins)) continue;
        if (!best || this.beats(rule, tally, best.tally)) best = { id, tally, player };
      }
      if (best)
        out.push({
          id: rule.id,
          playerId: best.id,
          name: best.player.name,
          value: best.tally.value,
        });
    }
    return out;
  }

  private observe(event: HeistEvent): void {
    for (const rule of RULES) {
      const score = rule.score(event);
      if (!score) continue;
      const seq = ++this.seq;
      let table = this.tallies.get(rule.id);
      if (!table) this.tallies.set(rule.id, (table = new Map()));
      const id = score.player.id;
      const had = table.get(id);
      if (!had) table.set(id, { value: score.value, at: seq });
      else if (score.combine === 'sum') table.set(id, { value: had.value + score.value, at: seq });
      else if (this.better(rule, score.value, had.value))
        table.set(id, { value: score.value, at: seq });
    }
  }

  private better(rule: AwardRule, a: number, b: number): boolean {
    return rule.lowWins ? a < b : a > b;
  }

  private beats(rule: AwardRule, a: Tally, b: Tally): boolean {
    if (a.value !== b.value) return this.better(rule, a.value, b.value);
    return a.at < b.at;
  }
}
