import type { HeistSettings, RejectReason } from '@heist/shared';
import type { Player } from '../game/Player';
import type { TaskRule } from './TaskRule';

const BRIEF_KEY = /^brief:/;

/**
 * `brief:plan`: between rounds, a signed-in player can plan the next heist as an open brief (set
 * the goal and the done-condition, write the queries, say how they know it worked). It gives
 * nothing in the game; a teacher marks it later and the marks count as Build (Phase 17.10).
 */
export class PlanningRule implements TaskRule {
  readonly betweenRounds = true;

  constructor(
    private readonly settings: HeistSettings,
    private readonly roundOver: () => boolean,
  ) {}

  handles(rewardKey: string): boolean {
    return BRIEF_KEY.test(rewardKey);
  }

  check(player: Player): RejectReason | undefined {
    // A brief is marked by a teacher, so it needs to know whose it is.
    if (!this.settings.planningBriefs || player.accountId === undefined) return 'not_allowed';
    return this.roundOver() ? undefined : 'not_allowed';
  }

  grant(): void {}
}
