import {
  raycastMap,
  type HeistSettings,
  type PoliceMessage,
  type RoadblocksMessage,
  type Rng,
  type SpawnPoint,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';
import { CHEST, EYE, driveNpc, nearestVisible, newNpcState, type NpcState } from './NpcDriver';

type Crime = 'lock' | 'guard' | 'kill' | 'officer';
type Settings = HeistSettings['police'];

/** How far from a street's centre line still counts as being on it (street plus pavement, m). */
const ON_STREET = 8;

/** Close enough to shoot: officers stop and fire instead of walking into the target. */
const STAND_OFF = 9;
/** Arrived at a post (m). */
const ARRIVED = 1.2;
/** How far ahead of a moving target a roadblock is set (m). */
const BLOCK_AHEAD = 70;
/** Ticks an officer may be stuck before it tries going round (sidestepping). */
const DETOUR_TICKS = 30;

interface Officer {
  readonly player: Player;
  /** A roadblock officer stays at its post instead of chasing. */
  readonly post: { x: number; z: number } | undefined;
  readonly npc: NpcState;
  /** Which way it is sidestepping to get round an obstacle, until the tick. */
  detour: { dir: 1 | -1; until: number } | undefined;
}

interface Heat {
  stars: number;
  /** Tick when an officer last saw the target (or the last crime); the escape clock runs from it. */
  lastSeen: number;
  readonly officers: Officer[];
  /** The roadblock has been set for this many stars (0 none). */
  blockFor: number;
  /** Where the roadblock stands (its middle), if set. */
  blockAt?: { x: number; z: number };
}

/** What the getaway tells the police (Phase 31.3). */
export interface PoliceIntel {
  /** Intel the player holds on the bank they are robbing (0 when not on a heist). */
  levelOf(player: Player): number;
  /** Where a player on the getaway is making for, if they are. */
  destination(player: Player): { x: number; z: number } | undefined;
}

/**
 * The police (Phase 29.4). Crimes — cracking a vault lock, bringing down a guard, killing a
 * player or an officer — earn stars. For each star officers are sent on foot to the criminal,
 * appearing out of sight and running them down; from the higher levels two officers also hold a
 * roadblock on the street ahead. Staying out of every officer's sight for long enough takes a star
 * away, and with none left the officers go. Dying clears the record.
 *
 * Pattern: Observer (of the heist events) — Why: the vault and combat rules know nothing of the
 * police; each crime is an event they already publish.
 */
export class PoliceSystem {
  private readonly heat = new Map<Player, Heat>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    events: HeistEvents,
    private readonly rng: Rng,
    /** Whether police are wanted in this room at all (not in the tutorial or a duel room). */
    private readonly active: () => boolean,
    private readonly intel: PoliceIntel = { levelOf: () => 0, destination: () => undefined },
  ) {
    events.subscribe((event) => {
      if (event.type === 'lock_opened' && event.player && !event.quiet)
        this.crime(event.player, 'lock');
      if (event.type === 'kill' && !event.victim.isDummy && event.killer !== event.victim)
        this.crime(event.killer, 'kill');
    });
  }

  /** Stars a player has now. */
  starsOf(player: Player): number {
    return this.heat.get(player)?.stars ?? 0;
  }

  /** Whether any officer chasing this player can see them (for stealth). */
  canSee(player: Player): boolean {
    const range = this.settings().sightRange;
    return this.officers().some(
      (o) => o.alive && nearestVisible(this.match, o, [player], range) !== undefined,
    );
  }

  /** Officers on the street right now (for tests and the debug overlay). */
  officers(): Player[] {
    return [...this.heat.values()].flatMap((h) => h.officers.map((o) => o.player));
  }

  /** A crime: the player earns stars. Only people in a room with police can be wanted. */
  crime(player: Player, kind: Crime): void {
    const s = this.settings();
    if (!s.enabled || !this.active() || player.isDummy || !player.alive) return;
    const heat = this.heat.get(player) ?? {
      stars: 0,
      lastSeen: this.match.tick,
      officers: [],
      blockFor: 0,
    };
    this.heat.set(player, heat);
    const before = heat.stars;
    heat.stars = Math.min(s.maxStars, heat.stars + s.crimeStars[kind]);
    heat.lastSeen = this.match.tick;
    if (heat.stars !== before) this.send(player, heat.stars);
  }

  /** An officer was brought down: a crime by whoever did it, and the officer is gone. */
  officerDown(officer: Player, killer: Player | undefined): void {
    if (killer && !killer.isDummy) this.crime(killer, 'officer');
    for (const h of this.heat.values()) {
      const i = h.officers.findIndex((o) => o.player === officer);
      if (i >= 0) h.officers.splice(i, 1);
    }
    this.match.removeNpc(officer);
  }

  /** A person left or died: their record and their officers go. */
  clear(player: Player): void {
    const heat = this.heat.get(player);
    if (!heat) return;
    const hadBlock = heat.blockAt !== undefined;
    this.dismiss(heat);
    this.heat.delete(player);
    if (hadBlock && this.match.getPlayer(player.id) === player)
      this.match.sendJson(player, { t: 'roadblocks', posts: [] } satisfies RoadblocksMessage);
    if (heat.stars > 0 && this.match.getPlayer(player.id) === player) this.send(player, 0);
  }

  /** A new round: nobody is wanted. */
  reset(): void {
    for (const p of [...this.heat.keys()]) this.clear(p);
  }

  onTick(): void {
    const s = this.settings();
    if (!s.enabled || !this.active()) return;
    const tick = this.match.tick;
    for (const [player, heat] of [...this.heat]) {
      if (!player.alive || this.match.getPlayer(player.id) !== player) {
        this.clear(player);
        continue;
      }
      this.staff(player, heat, s);
      this.officersAct(player, heat, s);
      // Out of sight long enough: a star goes.
      if (tick - heat.lastSeen > this.ticks(s.escapeSeconds)) {
        heat.stars--;
        heat.lastSeen = tick;
        this.send(player, heat.stars);
        if (heat.stars <= 0) this.clear(player);
      }
    }
  }

  /** Makes the number of officers match the stars (one new officer a tick), and the roadblock the level. */
  private staff(player: Player, heat: Heat, s: Settings): void {
    const chasers = heat.officers.filter((o) => !o.post);
    const want = heat.stars * s.perStar;
    if (chasers.length < want) this.spawn(player, heat, s, undefined);
    else if (chasers.length > want) this.drop(heat, chasers.at(-1) as Officer);
    const blockWanted = heat.stars >= s.roadblockFromStars ? heat.stars : 0;
    if (blockWanted === 0 && heat.blockFor !== 0) {
      for (const o of heat.officers.filter((x) => x.post)) this.drop(heat, o);
      heat.blockFor = 0;
      this.tellBlocks(player, heat, undefined);
    } else if (blockWanted > 0 && heat.blockFor === 0) {
      const posts = this.roadblockPosts(player);
      // Good intel on the bank thins the roadblock to one officer.
      const held = this.intel.levelOf(player) >= s.intelThinLevel ? posts.slice(0, 1) : posts;
      for (const post of held) this.spawn(player, heat, s, post);
      heat.blockFor = blockWanted;
      const middle = {
        x: posts.reduce((n, p) => n + p.x, 0) / posts.length,
        z: posts.reduce((n, p) => n + p.z, 0) / posts.length,
      };
      this.tellBlocks(player, heat, middle);
    }
  }

  private officersAct(player: Player, heat: Heat, s: Settings): void {
    const tick = this.match.tick;
    for (const o of [...heat.officers]) {
      const body = o.player.body;
      if (!o.player.alive) continue;
      if (Math.hypot(body.x - player.body.x, body.z - player.body.z) > s.activeRange) continue;
      const sees = nearestVisible(this.match, o.player, [player], s.sightRange);
      if (sees) heat.lastSeen = tick;
      const d = Math.hypot(player.body.x - body.x, player.body.z - body.z);
      let goal: { x: number; z: number } | undefined;
      if (o.post)
        goal = Math.hypot(o.post.x - body.x, o.post.z - body.z) > ARRIVED ? o.post : undefined;
      else if (!sees || d > STAND_OFF) goal = this.route(body, player.body, sees !== undefined);
      const aim = sees
        ? { x: player.body.x, y: player.body.y + CHEST, z: player.body.z }
        : undefined;
      // Blocked on the way: sidestep for a moment, the way a person would round a corner.
      let strafe = 0;
      if (o.detour && tick < o.detour.until) strafe = o.detour.dir;
      const { stuck } = driveNpc(
        this.match,
        o.player,
        o.npc,
        {
          goal,
          speed: s.speed,
          aim,
          fire: sees !== undefined,
          aimErrorDegrees: s.aimErrorDegrees,
          strafe,
        },
        this.rng,
      );
      if (stuck && !(o.detour && tick < o.detour.until)) {
        o.detour = { dir: this.rng.bool(0.5) ? 1 : -1, until: tick + DETOUR_TICKS };
        o.npc.stillTicks = 0;
      }
    }
  }

  /**
   * Officers keep to the streets: along the one they are on to the target's cross street, then
   * down it. Once the target is in sight (or the officer is off the grid) it is a straight run.
   */
  private route(
    from: { x: number; z: number },
    to: { x: number; z: number },
    sees: boolean,
  ): { x: number; z: number } {
    const city = this.match.map.city;
    if (!city || sees) return { x: to.x, z: to.z };
    const near = (lines: readonly number[], v: number) =>
      lines.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best), lines[0] ?? v);
    const lineZ = near(city.streetLinesZ, from.z);
    const lineX = near(city.streetLinesX, from.x);
    if (Math.abs(from.z - lineZ) <= ON_STREET) {
      const wx = near(city.streetLinesX, to.x);
      if (Math.abs(from.x - wx) > ARRIVED) return { x: wx, z: lineZ };
    } else if (Math.abs(from.x - lineX) <= ON_STREET) {
      const wz = near(city.streetLinesZ, to.z);
      if (Math.abs(from.z - wz) > ARRIVED) return { x: lineX, z: wz };
    }
    return { x: to.x, z: to.z };
  }

  /** Where officers appear: street spawns out of the target's sight and at the asked distance. */
  private spawnSpot(target: Player, s: Settings): SpawnPoint | undefined {
    const spawns = this.match.map.spawns;
    const order = this.rng.shuffle(spawns);
    const body = target.body;
    let fallback: SpawnPoint | undefined;
    for (const spot of order) {
      const d = Math.hypot(spot.x - body.x, spot.z - body.z);
      if (d < s.spawnMin || d > s.spawnMax) continue;
      const len = d || 1;
      const wall = raycastMap(
        this.match.map,
        body.x,
        body.y + EYE,
        body.z,
        (spot.x - body.x) / len,
        0,
        (spot.z - body.z) / len,
        d,
      );
      if (wall !== undefined && wall < d - 0.5) return spot; // out of sight: best
      fallback ??= spot;
    }
    return fallback;
  }

  private spawn(
    target: Player,
    heat: Heat,
    s: Settings,
    post: { x: number; z: number } | undefined,
  ): void {
    const spot = post ? { x: post.x, z: post.z, yaw: 0 } : this.spawnSpot(target, s);
    if (!spot) return;
    const player = this.match.addGuard('Police', spot, 0, s.weapon);
    player.isPolice = true;
    heat.officers.push({ player, post, npc: newNpcState(spot), detour: undefined });
  }

  private drop(heat: Heat, officer: Officer): void {
    const i = heat.officers.indexOf(officer);
    if (i >= 0) heat.officers.splice(i, 1);
    this.match.removeNpc(officer.player);
  }

  private dismiss(heat: Heat): void {
    for (const o of heat.officers.splice(0)) this.match.removeNpc(o.player);
    heat.blockFor = 0;
  }

  /** Tells a player with enough intel where the roadblock is (or that it is gone). */
  private tellBlocks(player: Player, heat: Heat, at: { x: number; z: number } | undefined): void {
    if (at) heat.blockAt = at;
    else delete heat.blockAt;
    if (this.intel.levelOf(player) < this.settings().intelRevealLevel && at) return;
    const message: RoadblocksMessage = { t: 'roadblocks', posts: at ? [at] : [] };
    this.match.sendJson(player, message);
  }

  /** The roadblock's middle for a player (for tests). */
  roadblockOf(player: Player): { x: number; z: number } | undefined {
    return this.heat.get(player)?.blockAt;
  }

  /**
   * Two posts across the street ahead of where the target is heading, at the nearest junction. On the
   * getaway the police have guessed where the loot is going: ahead is the way to the nearest safehouse.
   */
  private roadblockPosts(target: Player): { x: number; z: number }[] {
    const b = target.body;
    const speed = Math.hypot(b.vx, b.vz);
    const goal = this.intel.destination(target);
    const toGoal = goal ? Math.hypot(goal.x - b.x, goal.z - b.z) : 0;
    const dir =
      goal && toGoal > 1
        ? { x: (goal.x - b.x) / toGoal, z: (goal.z - b.z) / toGoal }
        : speed > 0.5
          ? { x: b.vx / speed, z: b.vz / speed }
          : { x: -Math.sin(target.yaw), z: -Math.cos(target.yaw) };
    const ahead = { x: b.x + dir.x * BLOCK_AHEAD, z: b.z + dir.z * BLOCK_AHEAD };
    const city = this.match.map.city;
    const near = (lines: readonly number[], v: number) =>
      lines.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best), lines[0] ?? v);
    const at = city
      ? { x: near(city.streetLinesX, ahead.x), z: near(city.streetLinesZ, ahead.z) }
      : ahead;
    // Across the way the target is heading: sideways to it.
    const side = { x: -dir.z, z: dir.x };
    return [-2.5, 2.5].map((k) => ({ x: at.x + side.x * k, z: at.z + side.z * k }));
  }

  private send(player: Player, stars: number): void {
    const msg: PoliceMessage = { t: 'police', stars, max: this.settings().maxStars };
    this.match.sendJson(player, msg);
  }

  private ticks(seconds: number): number {
    return Math.round(seconds * this.match.tickRate);
  }
}
