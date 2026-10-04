import {
  DEFAULT_HEIST_SETTINGS,
  jsonClientMessageSchema,
  mapWithClosedDoors,
  type HeistSettings,
} from '@heist/shared';
import type { Player } from '../game/Player';
import { ElevatorHandler } from './ElevatorHandler';
import { InteractionService } from './InteractionService';
import { VaultConsoleHandler } from './VaultConsoleHandler';
import { VaultRegistry } from './VaultRegistry';
import type { MatchApi } from './MatchApi';

/**
 * The heist rules of a match, behind the JSON messages. The match calls in;
 * this object decides what each message means and answers through MatchApi.
 * Pattern: Facade — Why: Match stays about movement and shooting; vaults,
 * loot and tasks grow here without touching the tick loop.
 */
export class HeistController {
  readonly interactions: InteractionService;
  readonly vaults: VaultRegistry;

  constructor(
    private readonly match: MatchApi,
    readonly settings: HeistSettings = DEFAULT_HEIST_SETTINGS,
  ) {
    this.vaults = new VaultRegistry(match.map, settings.locksPerVault);
    this.interactions = new InteractionService(match)
      .register('elevator', new ElevatorHandler())
      .register('vault_console', new VaultConsoleHandler(this.vaults));
    this.refreshDoors();
  }

  /** A player just joined: tell them where every vault stands. */
  onJoin(player: Player): void {
    this.match.sendJson(player, { t: 'vaults', vaults: this.vaults.views() });
  }

  /**
   * Opens lock `lock` of a vault (the SQL reward calls this). Returns false if
   * it was not the next lock, e.g. a second player solved the same one.
   */
  openLock(vaultId: string, lock: number): boolean {
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.openLock(lock) !== 'opened') return false;
    this.refreshDoors();
    this.match.broadcastJson({ t: 'vaults', vaults: this.vaults.views() });
    return true;
  }

  private refreshDoors(): void {
    this.match.setCollisionMap(mapWithClosedDoors(this.match.map, this.vaults.closedDoorIds()));
  }

  /** One JSON text frame from a player. Malformed input is ignored: the sender is untrusted. */
  onJson(player: Player, text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = jsonClientMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === 'interact') {
      this.match.sendJson(player, {
        t: 'interact_result',
        ref: message.ref,
        anchor: message.anchor,
        result: this.interactions.use(player, message.anchor),
      });
    }
  }
}
