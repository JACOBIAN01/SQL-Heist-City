import type { HeistSettings, WantedView } from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/**
 * Who has a price on their head. A living player carrying at least the
 * threshold is wanted: every few seconds everyone is told where the wanted
 * are (the minimap shows them, wherever they are), and killing one pays a
 * reward on top of the cash they drop. Carrying a fortune makes you the
 * target: bank it fast.
 */
export class BountyBoard {
  private readonly wanted = new Set<number>();
  private nextPostTick = 0;
  /** Whether the last post listed anyone (so the board is cleared once when the last one goes). */
  private posted = false;

  constructor(
    private readonly match: MatchApi,
    private readonly settings: HeistSettings,
    private readonly events: HeistEvents,
  ) {}

  isWanted(player: Player): boolean {
    return this.wanted.has(player.id);
  }

  /** Every tick: who is wanted changes at once (announced); the board is posted every few seconds. */
  onTick(): void {
    for (const p of this.match.playerList()) {
      const due = p.alive && p.cash >= this.settings.bountyThreshold;
      if (due && !this.wanted.has(p.id)) {
        this.wanted.add(p.id);
        this.events.publish({
          type: 'wanted',
          player: p,
          cash: p.cash,
          reward: this.settings.bountyReward,
        });
      } else if (!due) this.wanted.delete(p.id);
    }
    if (this.match.tick < this.nextPostTick) return;
    this.nextPostTick =
      this.match.tick + Math.max(1, Math.round(this.settings.bountyEverySec * this.match.tickRate));
    this.post();
  }

  /** Sends the board to everyone (now, e.g. to a player who just joined: pass them). */
  post(to?: Player): void {
    const list: WantedView[] = [];
    for (const id of this.wanted) {
      const p = this.match.getPlayer(id);
      if (p) list.push({ id, name: p.name, x: p.body.x, z: p.body.z, cash: p.cash });
    }
    const message = { t: 'bounties' as const, wanted: list, reward: this.settings.bountyReward };
    if (to) {
      if (list.length > 0) this.match.sendJson(to, message); // an empty board is the default
      return;
    }
    if (list.length === 0 && !this.posted) return; // nothing to say, and nothing to clear
    this.posted = list.length > 0;
    this.match.broadcastJson(message);
  }

  /**
   * A player died. If they were wanted and someone else killed them, that
   * killer earns the reward (returned, for the caller to pay). Either way they
   * are wanted no more.
   */
  claim(victim: Player, killer: Player | undefined): number {
    const was = this.wanted.delete(victim.id);
    if (!was || !killer || killer === victim || !killer.alive) return 0;
    const reward = this.settings.bountyReward;
    if (reward > 0) this.events.publish({ type: 'bounty_claimed', killer, victim, reward });
    return reward;
  }

  /** A new round, or a player left: forget them. */
  forget(player?: Player): void {
    if (player) this.wanted.delete(player.id);
    else this.wanted.clear();
  }
}
