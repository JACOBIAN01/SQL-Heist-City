import { districtAtPoint, type DiscoveryMessage } from '@heist/shared';
import type { Player } from '../game/Player';
import type { CollectionStore } from '../progress/CollectionStore';
import type { MatchApi } from './MatchApi';

/** How often (ticks) a player's position is checked against the districts. */
const EVERY = 10;

/**
 * Map discovery (Phase 30.5): a district is explored the first time a student stands in it, and the
 * full map keeps the districts they have not seen under fog. A signed-in student's discoveries are
 * kept with their account (in the same store as their data chips, under their own key); a guest
 * keeps them for the match.
 */
export class DiscoverySystem {
  private store: CollectionStore | undefined;
  private readonly seen = new Map<Player, Set<string>>();
  private readonly loading = new Set<Player>();

  constructor(
    private readonly match: MatchApi,
    private readonly active: () => boolean,
  ) {}

  bindStore(store: CollectionStore): void {
    this.store = store;
  }

  explored(player: Player): ReadonlySet<string> {
    return this.seen.get(player) ?? new Set();
  }

  forget(player: Player): void {
    this.seen.delete(player);
    this.loading.delete(player);
  }

  private key(id: string): string {
    return `district:${this.match.map.city?.settings.seed ?? 'city'}:${id}`;
  }

  onTick(): void {
    const city = this.match.map.city;
    if (!city || !this.active() || this.match.tick % EVERY !== 0) return;
    for (const player of this.match.playerList()) {
      if (player.isGuard || !player.alive) continue;
      const mine = this.seen.get(player);
      if (!mine) {
        this.load(player);
        continue;
      }
      const id = districtAtPoint(city.blocks, player.body.x, player.body.z);
      if (id === undefined || mine.has(id)) continue;
      mine.add(id);
      if (this.store && player.accountId !== undefined)
        void this.store.add(player.accountId, this.key(id)).catch(() => {});
      this.send(player);
    }
  }

  private load(player: Player): void {
    if (this.loading.has(player)) return;
    const store = this.store;
    const city = this.match.map.city;
    if (!store || player.accountId === undefined || !city) {
      this.seen.set(player, new Set());
      this.send(player);
      return;
    }
    this.loading.add(player);
    void store
      .found(player.accountId)
      .then((keys) =>
        this.seen.set(
          player,
          new Set(city.districts.map((d) => d.id).filter((id) => keys.has(this.key(id)))),
        ),
      )
      .catch(() => this.seen.set(player, new Set()))
      .finally(() => {
        this.loading.delete(player);
        this.send(player);
      });
  }

  private send(player: Player): void {
    const message: DiscoveryMessage = {
      t: 'discovery',
      districts: [...(this.seen.get(player) ?? [])].sort(),
    };
    this.match.sendJson(player, message);
  }
}
