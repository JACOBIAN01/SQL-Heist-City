import {
  anchorInReach,
  type HeistSettings,
  type ShopDenial,
  type ShopItem,
  type ShopMessage,
  type UpgradeDenial,
  type UpgradeId,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { InteractionHandler } from './InteractionService';
import { REACH_SLACK } from './InteractionService';
import type { MatchApi } from './MatchApi';

/** What the shop needs from the heist: cash moves, a reload, and the numbers. */
export interface ShopDeps {
  readonly match: MatchApi;
  readonly settings: () => HeistSettings['shop'];
  setCash(player: Player, cash: number): void;
  refillAmmo(player: Player): void;
  upgradeOffers(player: Player): ShopMessage['upgrades'];
}

/**
 * Street shops (Phase 29.6). The client only asks to buy; here the server checks that the player
 * is alive and standing at a shop, that the item exists, that it is of use and that the carried
 * cash covers it, and only then takes the cash and gives the item.
 * Pattern: Strategy (InteractionHandler) — Why: the shop is one more kind of usable spot, so it
 * plugs into the interaction registry without touching the checks every use shares.
 */
export class ShopService implements InteractionHandler {
  constructor(private readonly deps: ShopDeps) {}

  /** F at the counter: opens the window. */
  use(player: Player): { action: 'open_shop' } | { action: 'denied'; reason: 'not_available' } {
    if (!this.deps.settings().enabled) return { action: 'denied', reason: 'not_available' };
    this.send(player);
    return { action: 'open_shop' };
  }

  buy(player: Player, item: ShopItem): void {
    this.send(player, { item, ...this.attempt(player, item) });
  }

  private attempt(player: Player, item: ShopItem): { ok: boolean; reason?: ShopDenial } {
    const s = this.deps.settings();
    if (!s.enabled) return { ok: false, reason: 'closed' };
    if (!player.alive) return { ok: false, reason: 'dead' };
    if (!this.atCounter(player)) return { ok: false, reason: 'too_far' };
    const price = item === 'armour' ? s.armourPrice : s.ammoPrice;
    if (item === 'armour' && player.armour >= s.armourMax) return { ok: false, reason: 'full' };
    if (item === 'ammo' && !this.needsAmmo(player)) return { ok: false, reason: 'full' };
    if (player.cash < price) return { ok: false, reason: 'no_cash' };
    this.deps.setCash(player, player.cash - price);
    if (item === 'armour') player.armour = Math.min(s.armourMax, player.armour + s.armourPoints);
    else this.deps.refillAmmo(player);
    return { ok: true };
  }

  private needsAmmo(player: Player): boolean {
    const spec = this.deps.match.weaponSpec(player.weaponId);
    return spec !== undefined && player.arsenal.has(player.weaponId) && player.ammo < spec.magSize;
  }

  private atCounter(player: Player): boolean {
    const { x, y, z } = player.body;
    return (
      this.deps.match.map.anchors?.some(
        (a) =>
          a.kind === 'shop' && anchorInReach({ ...a, radius: a.radius + REACH_SLACK }, x, y, z),
      ) === true
    );
  }

  /** The shop window, with the answer to the last purchase if there was one. */
  send(
    player: Player,
    result?: ShopMessage['result'],
    upgrade?: { id: UpgradeId; ok: boolean; reason?: UpgradeDenial },
  ): void {
    const s = this.deps.settings();
    const message: ShopMessage = {
      t: 'shop',
      offers: [
        { item: 'armour', price: s.armourPrice },
        { item: 'ammo', price: s.ammoPrice },
      ],
      armour: player.armour,
      armourMax: s.armourMax,
      upgrades: this.deps.upgradeOffers(player),
      ...(upgrade
        ? {
            upgradeResult: {
              upgrade: upgrade.id,
              ok: upgrade.ok,
              ...(upgrade.reason ? { reason: upgrade.reason } : {}),
            },
          }
        : {}),
      ...(result ? { result } : {}),
    };
    this.deps.match.sendJson(player, message);
  }
}
