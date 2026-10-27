import {
  UPGRADE_IDS,
  anchorInReach,
  type HeistSettings,
  type ShopMessage,
  type UpgradeDenial,
  type UpgradeId,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { UpgradeStore } from '../progress/UpgradeStore';
import { REACH_SLACK } from './InteractionService';
import type { MatchApi } from './MatchApi';

type Settings = HeistSettings['upgrades'];

/**
 * Safehouse upgrades (Phase 30.4): faster banking, spawning with armour, keeping part of your cash
 * when you die, and seeing hidden finds from further off. Levels are bought at a shop counter with
 * *banked* cash and kept with a signed-in student's account (a guest has them for the match). The
 * effects are read by the systems they change, through the small `*Of` getters below.
 */
export class UpgradeSystem {
  private store: UpgradeStore | undefined;
  private readonly owned = new Map<Player, Record<string, number>>();
  private readonly loading = new Set<Player>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    /** Tells a player their shop window changed. */
    private readonly refresh: (player: Player, upgrade?: UpgradeId, result?: UpgradeResult) => void,
    /** A player's levels arrived: apply what applies at once (spawn armour). */
    private readonly loaded: (player: Player) => void,
  ) {}

  bindStore(store: UpgradeStore): void {
    this.store = store;
  }

  /** Reads a signed-in student's levels (a guest starts with none); calls `loaded` when ready. */
  load(player: Player): void {
    if (this.owned.has(player) || this.loading.has(player)) return;
    const store = this.store;
    if (!store || player.accountId === undefined) {
      this.owned.set(player, {});
      this.loaded(player);
      return;
    }
    this.loading.add(player);
    void store
      .levels(player.accountId)
      .then((levels) => this.owned.set(player, { ...levels }))
      .catch(() => this.owned.set(player, {}))
      .finally(() => {
        this.loading.delete(player);
        this.loaded(player);
        this.refresh(player);
      });
  }

  forget(player: Player): void {
    this.owned.delete(player);
    this.loading.delete(player);
  }

  level(player: Player, id: UpgradeId): number {
    const s = this.settings();
    const max = s[id].prices.length;
    return Math.min(max, this.owned.get(player)?.[id] ?? 0);
  }

  /** Banking takes this share of the usual time (1 = no upgrade). */
  bankingScale(player: Player): number {
    return Math.max(0.2, 1 - this.level(player, 'banking') * this.settings().banking.perLevel);
  }

  /** Armour a player spawns with. */
  spawnArmour(player: Player): number {
    return Math.round(this.level(player, 'armour') * this.settings().armour.perLevel);
  }

  /** The share of carried cash a player keeps when they die. */
  stashShare(player: Player): number {
    return Math.min(0.9, this.level(player, 'stash') * this.settings().stash.perLevel);
  }

  /** Extra metres at which hidden finds show for this player. */
  intelRange(player: Player): number {
    return this.level(player, 'intel') * this.settings().intel.perLevel;
  }

  /** What the shop window lists for a player. */
  offers(player: Player): ShopMessage['upgrades'] {
    const s = this.settings();
    if (!s.enabled) return [];
    return UPGRADE_IDS.map((id) => {
      const level = this.level(player, id);
      const prices = s[id].prices;
      const price = prices[level];
      return { id, level, max: prices.length, ...(price !== undefined ? { price } : {}) };
    });
  }

  buy(player: Player, id: UpgradeId): void {
    this.refresh(player, id, this.attempt(player, id));
  }

  private attempt(player: Player, id: UpgradeId): UpgradeResult {
    const s = this.settings();
    if (!s.enabled) return { ok: false, reason: 'closed' };
    if (!player.alive) return { ok: false, reason: 'dead' };
    const { x, y, z } = player.body;
    const atCounter = this.match.map.anchors?.some(
      (a) => a.kind === 'shop' && anchorInReach({ ...a, radius: a.radius + REACH_SLACK }, x, y, z),
    );
    if (!atCounter) return { ok: false, reason: 'too_far' };
    const owned = this.owned.get(player);
    if (!owned) return { ok: false, reason: 'not_ready' };
    const level = this.level(player, id);
    const price = s[id].prices[level];
    if (price === undefined) return { ok: false, reason: 'max' };
    if (player.banked < price) return { ok: false, reason: 'no_cash' };
    player.banked -= price;
    owned[id] = level + 1;
    if (this.store && player.accountId !== undefined)
      void this.store.setLevel(player.accountId, id, level + 1).catch(() => {});
    this.loaded(player);
    return { ok: true };
  }
}

export interface UpgradeResult {
  readonly ok: boolean;
  readonly reason?: UpgradeDenial;
}
