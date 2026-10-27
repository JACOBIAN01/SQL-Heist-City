import {
  cacheSites,
  type CacheSite,
  type CachesMessage,
  type HeistSettings,
  type SeededRng,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { MatchApi } from './MatchApi';

type Settings = HeistSettings['caches'];

/**
 * Hidden caches (Phase 30.2). Each round the city hides a few piles of cash on open ground. A player
 * only learns of one that is near (or that intel reveals), and walking over it pays the carried
 * cash. All of it is decided here; the client only draws what it is told.
 * Pattern: Observer (per-player visibility) — Why: each player is sent only the caches they can
 * see, and only when that set changes, so hidden ones stay hidden and traffic stays small.
 */
export class CacheSystem {
  private sites: CacheSite[] = [];
  private readonly taken = new Set<number>();
  /** What each player was last told they can see, as a key to compare. */
  private readonly told = new Map<Player, string>();
  /** Caches an intel job has revealed to a player from any distance (Phase 33 hooks in here). */
  private readonly revealed = new Map<Player, Set<number>>();
  private round = 0;

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    private readonly rng: SeededRng,
    private readonly pay: (player: Player, amount: number) => void,
    private readonly active: () => boolean,
  ) {}

  /** Where the live caches are (for tests and the debug overlay). */
  live(): readonly CacheSite[] {
    return this.sites.filter((s) => !this.taken.has(s.id));
  }

  /** A new round: hide them somewhere new. */
  reset(): void {
    this.round++;
    this.taken.clear();
    this.told.clear();
    this.revealed.clear();
    const s = this.settings();
    const city = this.match.map.city;
    this.sites =
      s.enabled && this.active() && city
        ? cacheSites(city, this.rng.fork(`round:${this.round}`), s.count)
        : [];
  }

  /** Shows a player these caches from anywhere (intel). */
  reveal(player: Player, ids: readonly number[]): void {
    const set = this.revealed.get(player) ?? new Set<number>();
    for (const id of ids) set.add(id);
    this.revealed.set(player, set);
  }

  forget(player: Player): void {
    this.told.delete(player);
    this.revealed.delete(player);
  }

  onTick(): void {
    const s = this.settings();
    if (this.sites.length === 0) return;
    for (const player of this.match.playerList()) {
      if (player.isGuard || !player.alive) continue;
      this.collect(player, s);
      this.show(player, s);
    }
  }

  private collect(player: Player, s: Settings): void {
    for (const site of this.live()) {
      if (Math.abs(player.body.y - 0) > 2) continue;
      if (Math.hypot(site.x - player.body.x, site.z - player.body.z) > s.pickupRadius) continue;
      this.taken.add(site.id);
      this.pay(player, s.amount);
      this.told.delete(player);
      this.show(player, s, s.amount);
      // Everyone else's view loses it too.
      for (const other of this.match.playerList()) if (other !== player) this.told.delete(other);
    }
  }

  private show(player: Player, s: Settings, found?: number): void {
    const own = this.revealed.get(player);
    const visible = this.live().filter(
      (c) =>
        own?.has(c.id) || Math.hypot(c.x - player.body.x, c.z - player.body.z) <= s.revealRange,
    );
    const key = visible.map((c) => c.id).join(',');
    if (found === undefined && this.told.get(player) === key) return;
    this.told.set(player, key);
    const message: CachesMessage = {
      t: 'caches',
      caches: visible.map((c) => ({ id: c.id, x: c.x, z: c.z })),
      ...(found !== undefined ? { found: { amount: found } } : {}),
    };
    this.match.sendJson(player, message);
  }
}
