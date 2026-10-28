import type { RoundReplay, AwardView, SquadAwardView, SquadStandingView } from '@heist/shared';
import type { Player } from '../game/Player';
import type { Vault } from './Vault';

/** What happened in the heist, as rule code reports it. */
/** One player's result for a finished round (plain data, safe to send between threads). */
export interface PlayerRoundResult {
  readonly rank: number;
  /** The signed-in account behind the player; absent for unsigned play. */
  readonly accountId?: number;
  readonly name: string;
  readonly banked: number;
  readonly kills: number;
  readonly deaths: number;
  /** Passed a question with the cheat code this round: earns no XP for it (Phase 37). */
  readonly cheated?: boolean;
}

export interface RoundResult {
  /** 1 for the first round of the match. */
  readonly number: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly standings: readonly PlayerRoundResult[];
  readonly awards: readonly AwardView[];
  /** Squad table of the round (Phase 27), when the class plays in squads. */
  readonly squads?: readonly SquadStandingView[];
  readonly squadAwards?: readonly SquadAwardView[];
  /** The round as recorded for the teacher to replay (Phase 35.2). */
  readonly replay?: RoundReplay;
}

export type HeistEvent =
  /** A round just finished. */
  | { readonly type: 'round_end'; readonly result: RoundResult }
  | {
      readonly type: 'lock_opened';
      readonly vault: Vault;
      readonly lock: number;
      /** Who solved it (absent when a tool or test opened it). */
      readonly player?: Player;
      /** Cracked quietly (stealth, and nobody saw): no alarm, no police. */
      readonly quiet?: boolean;
      /** Cash paid to the cracker at once for a loud lock. */
      readonly bonus?: number;
    }
  | {
      readonly type: 'vault_opened';
      readonly vault: Vault;
      /** Who cracked the last lock, and what the vault's cash was made of. */
      readonly by?: Player;
      readonly base?: number;
      readonly ghostAmount?: number;
      readonly intelAmount?: number;
    }
  /** A heist ended in the bank: the take was banked (Phase 31.4). */
  | {
      readonly type: 'heist_complete';
      readonly player: Player;
      readonly bank: string;
      readonly tier: number;
      readonly mastery: number;
      /** The cash banked from the vault (Phase 34.6). */
      readonly take?: number;
    }
  /** A player gained an intel point on a bank (Phase 32.2: the story listens). */
  | {
      readonly type: 'intel_gained';
      readonly player: Player;
      readonly bank: string;
      readonly level: number;
    }
  /** A player finished a contract and was paid (Phase 32.2). */
  | { readonly type: 'job_done'; readonly player: Player; readonly kind: string }
  /** A getaway ended in death with the take on the player (Phase 32.3: the fixer says so). */
  | { readonly type: 'heist_failed'; readonly player: Player; readonly bank: string }
  /** A player's wanted level changed (Phase 32.3). */
  | { readonly type: 'stars'; readonly player: Player; readonly stars: number }
  /** A student finished a bank's story chain (Phase 32.2). */
  | {
      readonly type: 'chain_complete';
      readonly player: Player;
      readonly bank: string;
      readonly xp: number;
    }
  /** A player picked up a cash bag (Phase 31.1). */
  | {
      readonly type: 'bag_taken';
      readonly player: Player;
      readonly amount: number;
      readonly x: number;
      readonly z: number;
    }
  | { readonly type: 'banked'; readonly player: Player; readonly amount: number }
  /** A SQL task was answered correctly and its reward applied. */
  | {
      readonly type: 'task_solved';
      readonly player: Player;
      readonly rewardKey: string;
      /** From the question being issued to the correct answer, when known. */
      readonly seconds?: number;
    }
  /** A question was passed with the cheat code: the world reacts (the reward may be paid), learning does not (Phase 37). */
  | { readonly type: 'task_cheated'; readonly player: Player; readonly rewardKey: string }
  /** A player killed another (not themselves, not a practice target). */
  | { readonly type: 'kill'; readonly killer: Player; readonly victim: Player }
  | {
      readonly type: 'wanted';
      readonly player: Player;
      readonly cash: number;
      readonly reward: number;
    }
  | {
      readonly type: 'bounty_claimed';
      readonly killer: Player;
      readonly victim: Player;
      readonly reward: number;
    };

/**
 * The heist's event bus.
 * Pattern: Observer — Why: vault, banking and bounty rules say what happened
 * once; the event feed and the round awards (and anything later) listen without
 * those rules knowing who cares.
 */
export class HeistEvents {
  private readonly listeners: ((event: HeistEvent) => void)[] = [];

  subscribe(listener: (event: HeistEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  publish(event: HeistEvent): void {
    for (const l of this.listeners) l(event);
  }
}
