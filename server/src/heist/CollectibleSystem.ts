import {
  collectibleSites,
  type CacheSite,
  type CollectionMessage,
  type HeistSettings,
  type SeededRng,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { CollectionStore } from '../progress/CollectionStore';
import type { MatchApi } from './MatchApi';

type Settings = HeistSettings['collectibles'];

/**
 * Collectible data chips (Phase 30.3). The chips stand in the same places every round; each shows a
 * piece of SQL trivia once picked up, and a signed-in student's finds are kept with their account
 * (a guest keeps them for the match). The server decides what is near, what is found and what it
 * pays; the client draws the list it is sent.
 */
export class CollectibleSystem {
  private sites: CacheSite[] | undefined;
  private store: CollectionStore | undefined;
  /** What each player has found, by chip number; absent until loaded. */
  private readonly found = new Map<Player, Set<number>>();
  private readonly loading = new Set<Player>();
  private readonly told = new Map<Player, string>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    private readonly rng: () => SeededRng,
    private readonly pay: (player: Player, amount: number) => void,
    private readonly active: () => boolean,
    /** Extra metres a player sees chips from (a safehouse upgrade). */
    private readonly bonus: (player: Player) => number = () => 0,
  ) {}

  /** Where signed-in students' finds are kept (set once the match is bound to progress). */
  bindStore(store: CollectionStore): void {
    this.store = store;
  }

  /** The chips of this city (for tests). */
  chips(): readonly CacheSite[] {
    const city = this.match.map.city;
    const s = this.settings();
    if (!city || !s.enabled || !this.active()) return [];
    this.sites ??= collectibleSites(city, this.rng(), s.count);
    return this.sites;
  }

  foundBy(player: Player): ReadonlySet<number> {
    return this.found.get(player) ?? new Set();
  }

  forget(player: Player): void {
    this.found.delete(player);
    this.loading.delete(player);
    this.told.delete(player);
  }

  onTick(): void {
    const chips = this.chips();
    if (chips.length === 0) return;
    const s = this.settings();
    for (const player of this.match.playerList()) {
      if (player.isGuard || !player.alive) continue;
      const mine = this.found.get(player);
      if (!mine) {
        this.load(player);
        continue;
      }
      let latest: number | undefined;
      for (const chip of chips) {
        if (mine.has(chip.id)) continue;
        if (Math.abs(player.body.y) > 2) continue;
        if (Math.hypot(chip.x - player.body.x, chip.z - player.body.z) > s.pickupRadius) continue;
        mine.add(chip.id);
        latest = chip.id;
        this.pay(player, s.cash);
        this.record(player, chip.id);
      }
      this.show(player, chips, s, latest);
    }
  }

  private key(id: number): string {
    return `${this.match.map.city?.settings.seed ?? 'city'}:${id}`;
  }

  private load(player: Player): void {
    if (this.loading.has(player)) return;
    const store = this.store;
    if (!store || player.accountId === undefined) {
      this.found.set(player, new Set());
      return;
    }
    this.loading.add(player);
    void store
      .found(player.accountId)
      .then((keys) => {
        const ids = new Set<number>();
        for (const chip of this.chips()) if (keys.has(this.key(chip.id))) ids.add(chip.id);
        this.found.set(player, ids);
      })
      .catch(() => this.found.set(player, new Set()))
      .finally(() => this.loading.delete(player));
  }

  private record(player: Player, id: number): void {
    if (!this.store || player.accountId === undefined) return;
    void this.store.add(player.accountId, this.key(id)).catch(() => {});
  }

  private show(
    player: Player,
    chips: readonly CacheSite[],
    s: Settings,
    latest: number | undefined,
  ): void {
    const mine = this.found.get(player) ?? new Set<number>();
    const near = chips.filter(
      (c) =>
        !mine.has(c.id) &&
        Math.hypot(c.x - player.body.x, c.z - player.body.z) <= s.revealRange + this.bonus(player),
    );
    const key = `${[...mine].sort().join(',')}|${near.map((c) => c.id).join(',')}`;
    if (latest === undefined && this.told.get(player) === key) return;
    this.told.set(player, key);
    const message: CollectionMessage = {
      t: 'collection',
      near: near.map((c) => ({ id: c.id, x: c.x, z: c.z })),
      found: [...mine]
        .sort((a, b) => a - b)
        .map((id) => {
          const card = s.trivia[(id - 1) % s.trivia.length];
          return { id, title: card?.title ?? '', fact: card?.fact ?? '' };
        }),
      total: chips.length,
      ...(latest !== undefined ? { latest } : {}),
    };
    this.match.sendJson(player, message);
  }
}
