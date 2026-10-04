import type { MapVault, VaultView } from '@heist/shared';

export type LockOutcome = 'opened' | 'already_open' | 'out_of_order';

/**
 * One vault's lock progress. Shared by everyone in the match and kept for the
 * whole round: a lock opened by anybody stays open, through deaths and
 * disconnects (docs/gameplay.md). Locks open strictly in order.
 */
export class Vault {
  private opened = 0;

  constructor(
    readonly spec: MapVault,
    readonly lockCount: number,
  ) {}

  get locksOpen(): number {
    return this.opened;
  }

  get isOpen(): boolean {
    return this.opened >= this.lockCount;
  }

  /** The lock a player should work on next (1-based), or undefined once the vault is open. */
  get nextLock(): number | undefined {
    return this.isOpen ? undefined : this.opened + 1;
  }

  /** Opens lock `k` if it is the next one. A second solver of the same lock changes nothing. */
  openLock(k: number): LockOutcome {
    if (k <= this.opened) return 'already_open';
    if (k !== this.opened + 1) return 'out_of_order';
    this.opened++;
    return 'opened';
  }

  view(): VaultView {
    return { id: this.spec.id, tier: this.spec.tier, locks: this.lockCount, opened: this.opened };
  }
}
