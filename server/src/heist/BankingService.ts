import { anchorInReach, type BankingCancel, type MapAnchor } from '@heist/shared';
import type { Player } from '../game/Player';
import { REACH_SLACK } from './InteractionService';
import type { MatchApi } from './MatchApi';

interface Channel {
  readonly anchor: MapAnchor;
  readonly endTick: number;
}

export interface BankingHooks {
  /** Moves the cash: carried → banked. Returns the amount banked. */
  complete(player: Player): number;
}

/**
 * Banking is a short channel: stand at a safehouse for a few seconds,
 * unhurt, and what you carry becomes safe. Damage, walking away or dying
 * breaks it and nothing is lost but the time (docs/gameplay.md).
 */
export class BankingService {
  private readonly channels = new Map<Player, Channel>();

  constructor(
    private readonly match: MatchApi,
    private readonly seconds: number,
    private readonly hooks: BankingHooks,
  ) {}

  /** Whether this player is mid-banking (for tests and the HUD). */
  isBanking(player: Player): boolean {
    return this.channels.has(player);
  }

  start(player: Player, anchor: MapAnchor): number {
    this.channels.set(player, {
      anchor,
      endTick: this.match.tick + Math.ceil(this.seconds * this.match.tickRate),
    });
    this.match.sendJson(player, { t: 'banking', status: 'started', seconds: this.seconds });
    return this.seconds;
  }

  cancel(player: Player, reason: BankingCancel): void {
    if (!this.channels.delete(player)) return;
    this.match.sendJson(player, { t: 'banking', status: 'cancelled', reason });
  }

  /** Breaks every channel (the round ended or restarted). */
  cancelAll(reason: BankingCancel): void {
    for (const player of [...this.channels.keys()]) this.cancel(player, reason);
  }

  /** Every tick: finish channels that ran their time, break those whose player wandered off. */
  onTick(): void {
    for (const [player, channel] of this.channels) {
      const { x, y, z } = player.body;
      const near = anchorInReach(
        { ...channel.anchor, radius: channel.anchor.radius + REACH_SLACK },
        x,
        y,
        z,
      );
      if (!player.alive) this.cancel(player, 'died');
      else if (!near) this.cancel(player, 'moved');
      else if (this.match.tick >= channel.endTick) {
        this.channels.delete(player);
        this.match.sendJson(player, {
          t: 'banking',
          status: 'done',
          amount: this.hooks.complete(player),
        });
      }
    }
  }
}
