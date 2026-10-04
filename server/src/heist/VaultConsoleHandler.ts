import type { InteractResult, MapAnchor } from '@heist/shared';
import type { Player } from '../game/Player';
import type { InteractionHandler } from './InteractionService';
import type { MatchApi } from './MatchApi';
import type { VaultRegistry } from './VaultRegistry';

/** Reward key of lock `k` of a bank: the question tier follows from it (docs/gameplay.md). */
export const vaultRewardKey = (tier: number, lock: number): string =>
  `vault:bank-${tier}:lock-${lock}`;

/** Using a vault console starts a task for the next closed lock, or says the vault is already open. */
export class VaultConsoleHandler implements InteractionHandler {
  constructor(private readonly vaults: VaultRegistry) {}

  use(_player: Player, anchor: MapAnchor, _match: MatchApi): InteractResult {
    const vault = this.vaults.byConsole(anchor.id);
    const lock = vault?.nextLock;
    if (!vault || lock === undefined) return { action: 'denied', reason: 'not_available' };
    return {
      action: 'open_task',
      rewardKey: vaultRewardKey(vault.spec.tier, lock),
      target: vault.spec.id,
    };
  }
}
