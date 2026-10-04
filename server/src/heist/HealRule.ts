import type { HeistSettings, RejectReason } from '@heist/shared';
import type { Player } from '../game/Player';
import type { MatchApi } from './MatchApi';
import type { TaskRule } from './TaskRule';

const HEAL_KEY = /^heal:(.+)$/;

/**
 * `heal:<tier>`: solve a question, get hit points back (how many per tier is
 * a setting, so teachers tune it). Pointless at full health, so refused
 * then: it would spend a question for nothing.
 */
export class HealRule implements TaskRule {
  constructor(
    private readonly match: MatchApi,
    private readonly settings: HeistSettings,
  ) {}

  handles(rewardKey: string): boolean {
    return HEAL_KEY.test(rewardKey);
  }

  check(player: Player, rewardKey: string): RejectReason | undefined {
    if (this.amountFor(rewardKey) === undefined) return 'unknown_reward';
    if (!player.alive || player.hp >= this.match.maxHp) return 'not_allowed';
    return undefined;
  }

  grant(player: Player, rewardKey: string): void {
    const amount = this.amountFor(rewardKey);
    if (amount === undefined || !player.alive) return;
    player.hp = Math.min(this.match.maxHp, player.hp + amount);
  }

  private amountFor(rewardKey: string): number | undefined {
    const tier = HEAL_KEY.exec(rewardKey)?.[1];
    return tier === undefined ? undefined : this.settings.healByTier[tier];
  }
}
