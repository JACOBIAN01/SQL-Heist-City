import { findAnchor, anchorInReach, type RejectReason } from '@heist/shared';
import type { Player } from '../game/Player';
import { REACH_SLACK } from './InteractionService';
import type { MatchApi } from './MatchApi';
import type { TaskRule } from './TaskRule';
import { vaultRewardKey } from './VaultConsoleHandler';
import type { VaultRegistry } from './VaultRegistry';

const VAULT_KEY = /^vault:/;

export interface VaultLockHooks {
  /** A lock was opened by this player (true) or somebody else got there first (false). */
  readonly onSolved: (player: Player, vaultId: string, lock: number, opened: boolean) => void;
}

/**
 * A vault lock: allowed only at that vault's console, and only for the next
 * lock in line. The client names the vault in `target`; everything else is
 * checked against the server's own state.
 */
export class VaultLockRule implements TaskRule {
  constructor(
    private readonly vaults: VaultRegistry,
    private readonly match: MatchApi,
    private readonly open: (vaultId: string, lock: number, by: Player) => boolean,
    private readonly hooks: VaultLockHooks,
  ) {}

  handles(rewardKey: string): boolean {
    return VAULT_KEY.test(rewardKey);
  }

  check(player: Player, rewardKey: string, target: string | undefined): RejectReason | undefined {
    const vault = target ? this.vaults.get(target) : undefined;
    if (!vault) return 'not_allowed';
    if (!player.alive) return 'not_allowed';
    const lock = vault.nextLock;
    if (lock === undefined) return 'not_allowed';
    if (rewardKey !== vaultRewardKey(vault.spec.tier, lock)) return 'not_allowed';
    const console = findAnchor(this.match.map, vault.spec.consoleId);
    const { x, y, z } = player.body;
    if (!console || !anchorInReach({ ...console, radius: console.radius + REACH_SLACK }, x, y, z))
      return 'not_allowed';
    return undefined;
  }

  grant(player: Player, rewardKey: string, target: string | null): void {
    const lock = /:lock-(\d+)$/.exec(rewardKey)?.[1];
    if (!target || !lock) return;
    const k = Number(lock);
    this.hooks.onSolved(player, target, k, this.open(target, k, player));
  }
}
