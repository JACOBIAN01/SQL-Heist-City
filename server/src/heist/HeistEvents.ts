import type { Player } from '../game/Player';
import type { Vault } from './Vault';

/** What happened in the heist, as rule code reports it. */
export type HeistEvent =
  | {
      readonly type: 'lock_opened';
      readonly vault: Vault;
      readonly lock: number;
      /** Who solved it (absent when a tool or test opened it). */
      readonly player?: Player;
    }
  | { readonly type: 'vault_opened'; readonly vault: Vault }
  | { readonly type: 'banked'; readonly player: Player; readonly amount: number }
  /** A SQL task was answered correctly and its reward applied. */
  | {
      readonly type: 'task_solved';
      readonly player: Player;
      readonly rewardKey: string;
      /** From the question being issued to the correct answer, when known. */
      readonly seconds?: number;
    }
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
