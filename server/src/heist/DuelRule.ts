import type { RejectReason } from '@heist/shared';
import type { Player } from '../game/Player';
import type { DuelManager } from './DuelManager';
import type { TaskRule } from './TaskRule';

/**
 * `duel:draw`: the question of a SQL Quick Draw draw. It can only be asked for while the duel's
 * draw is open, and a correct answer is a point for the first to give one.
 */
export class DuelRule implements TaskRule {
  constructor(private readonly duels: DuelManager) {}

  handles(rewardKey: string): boolean {
    return rewardKey === 'duel:draw';
  }

  check(player: Player): RejectReason | undefined {
    return this.duels.canAnswer(player) ? undefined : 'not_allowed';
  }

  grant(player: Player): void {
    this.duels.solved(player);
  }
}
