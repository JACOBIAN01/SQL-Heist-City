import type { Player } from '../game/Player';
import type { Vault } from './Vault';

/** What happened in the heist, as rule code reports it. */
export type HeistEvent =
  | { readonly type: 'lock_opened'; readonly vault: Vault; readonly lock: number }
  | { readonly type: 'vault_opened'; readonly vault: Vault }
  | { readonly type: 'banked'; readonly player: Player; readonly amount: number }
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
 * once; the event feed (and anything later: awards, metrics) listens without
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
