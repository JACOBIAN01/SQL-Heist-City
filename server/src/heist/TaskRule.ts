import type { RejectReason } from '@heist/shared';
import type { Player } from '../game/Player';

/**
 * What a kind of SQL task means in the game: when a player may start it and
 * what solving it gives. Reward keys are data (docs/gameplay.md); each rule
 * owns the keys of one family ("vault:…", "heal:…", "gun:…").
 * Pattern: Strategy (registry by reward key) — Why: heals, guns and vault
 * locks each have their own preconditions and effects; adding a reward is a
 * new rule, and the challenge flow around it never changes.
 */
export interface TaskRule {
  handles(rewardKey: string): boolean;
  /** A reason the player may not start this task now, or undefined if they may. */
  check(player: Player, rewardKey: string, target: string | undefined): RejectReason | undefined;
  /** The server graded the answer correct: apply the reward. `target` is what the task was issued for. */
  grant(player: Player, rewardKey: string, target: string | null): void;
}

export class TaskRules {
  private readonly rules: TaskRule[] = [];

  add(rule: TaskRule): this {
    this.rules.push(rule);
    return this;
  }

  find(rewardKey: string): TaskRule | undefined {
    return this.rules.find((r) => r.handles(rewardKey));
  }
}
