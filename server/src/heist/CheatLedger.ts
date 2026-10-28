import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';

/**
 * Who passed a question with the cheat code this round (Phase 37.3). The world lets them through,
 * but anything that rewards learning or skill — heist mastery XP, story XP, round XP, a ghost record —
 * asks this first and pays nothing to someone who has cheated. The mark lasts to the end of the round.
 * Pattern: Observer — Why: it follows `task_cheated`; the systems that pay out only ask a question.
 */
export class CheatLedger {
  private readonly cheated = new Set<Player>();

  constructor(events: HeistEvents) {
    events.subscribe((e) => {
      if (e.type === 'task_cheated') this.cheated.add(e.player);
    });
  }

  has(player: Player): boolean {
    return this.cheated.has(player);
  }

  /** Who cheated, for marking the round's table. */
  all(): readonly Player[] {
    return [...this.cheated];
  }

  forget(player: Player): void {
    // A player who leaves keeps the mark until the round ends: coming back must not wash it off.
    void player;
  }

  reset(): void {
    this.cheated.clear();
  }
}
