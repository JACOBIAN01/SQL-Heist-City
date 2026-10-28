import {
  findAnchor,
  raycastMap,
  type GameMap,
  type HeistSettings,
  type MapAnchor,
  type MapVault,
  type Rng,
} from '@heist/shared';
import { CHEST, EYE, driveNpc, nearestVisible, newNpcState, type NpcState } from './NpcDriver';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** Guards close to this distance (m) on a target, and no further: they shoot, they do not charge. */
const STAND_OFF = 7;
/** Arrived, for a waypoint or the console (m). */
const ARRIVED = 1.2;
/** Seconds a guard keeps looking where it last saw someone. */
const LOOK_SECONDS = 4;

interface Guard {
  readonly player: Player;
  readonly vault: MapVault;
  readonly console: MapAnchor;
  readonly beat: readonly { readonly x: number; readonly z: number }[];
  at: number;
  /** Tick until which the guard stands at a waypoint before moving on. */
  waitUntil: number;
  /** Tick until which the guard is on alert at its console (an alarm rang). */
  alertUntil: number;
  seen: { x: number; z: number; tick: number } | undefined;
  npc: NpcState;
}

/**
 * The points of a guard's beat: a ring round the vault console on its own floor, keeping the
 * ones the console can see (so a guard never walks a beat through a wall). A cramped room gets
 * just the console's own spot.
 */
export function beatAround(
  map: GameMap,
  console_: Pick<MapAnchor, 'x' | 'y' | 'z'>,
  radius: number,
): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const wall = raycastMap(map, console_.x, console_.y + EYE, console_.z, dx, 0, dz, radius + 0.5);
    if (wall === undefined)
      points.push({ x: console_.x + dx * radius, z: console_.z + dz * radius });
  }
  return points.length > 0 ? points : [{ x: console_.x, z: console_.z }];
}

/**
 * Bank guards (Phase 29.3). Each bank's vault has a few: they walk a short beat round the console,
 * hold it when a lock is cracked (the alarm), and shoot at any player they can see. A guard is a
 * computer-driven player: it moves and fires through the very same input path as a person (so
 * walls, spread, fire rate and damage are all the real rules), and anything that can be shot can
 * be shot by it.
 *
 * Pattern: Observer (of the heist events) — Why: the vault rules know nothing of guards; the
 * alarm is just "a lock opened", which the guards listen for.
 */
export class GuardSystem {
  private guards: Guard[] = [];
  private placed = false;
  /** Banks whose guards are blinded, until this tick. */
  private readonly blindUntil = new Map<string, number>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => HeistSettings['guards'],
    events: HeistEvents,
    private readonly rng: Rng,
    /** How long the alarm rings, as a share, for whoever cracked the lock (intel shortens it). */
    private readonly alertScale: (player: Player | undefined, bank: string) => number = () => 1,
  ) {
    events.subscribe((event) => {
      if (event.type !== 'lock_opened' || event.quiet) return;
      const scale = this.alertScale(event.player, `bank-${event.vault.spec.tier}`);
      const until = this.match.tick + this.ticks(this.settings().alertSeconds * scale);
      for (const g of this.guards) if (g.vault.id === event.vault.spec.id) g.alertUntil = until;
    });
  }

  get count(): number {
    return this.guards.length;
  }

  /** The alarm at a bank is over: its guards stand down (the inside man's tip). */
  calm(bank: string): void {
    for (const g of this.guards) if (`bank-${g.vault.tier}` === bank) g.alertUntil = 0;
  }

  /** A bank's guards cannot see anyone for a while (a sabotage contract). */
  blind(bank: string, seconds: number): void {
    this.blindUntil.set(bank, this.match.tick + this.ticks(seconds));
  }

  private isBlind(g: { vault: { tier: number } }): boolean {
    return this.match.tick < (this.blindUntil.get(`bank-${g.vault.tier}`) ?? 0);
  }

  /** Whether any guard on duty can see this player right now (for stealth). */
  canSee(player: Player): boolean {
    const range = this.settings().sightRange;
    return this.guards.some(
      (g) =>
        g.player.alive &&
        !this.isBlind(g) &&
        nearestVisible(this.match, g.player, [player], range) !== undefined,
    );
  }

  /** The bank (`bank-3`) a guard works at. */
  bankOf(player: Player): string | undefined {
    const g = this.guards.find((x) => x.player === player);
    return g ? `bank-${g.vault.tier}` : undefined;
  }

  /** The guards as the city database lists them (Phase 33.1). */
  snapshot(): { id: number; bank: string; x: number; z: number; storey: number; alert: boolean }[] {
    const tick = this.match.tick;
    return this.guards
      .filter((g) => g.player.alive)
      .map((g) => ({
        id: g.player.id,
        bank: `bank-${g.vault.tier}`,
        x: g.player.body.x,
        z: g.player.body.z,
        storey: Math.round(g.player.body.y / 3),
        alert: tick < g.alertUntil,
      }));
  }

  /** The guards, for tests and the debug overlay. */
  all(): readonly Player[] {
    return this.guards.map((g) => g.player);
  }

  /** A new round: the alarm is over and every guard is back on its beat. */
  reset(): void {
    this.blindUntil.clear();
    for (const g of this.guards) {
      g.alertUntil = 0;
      g.seen = undefined;
      g.at = 0;
    }
  }

  /** Puts the guards in the banks (once, when the match is running). */
  private place(): void {
    this.placed = true;
    const map = this.match.map;
    const s = this.settings();
    for (const vault of map.vaults ?? []) {
      const count = s.perBankTier[String(vault.tier)] ?? 0;
      const console_ = findAnchor(map, vault.consoleId);
      if (count <= 0 || !console_) continue;
      const beat = beatAround(map, console_, s.beatRadius);
      for (let n = 0; n < count; n++) {
        const spot = beat[(n * 3) % beat.length] as { x: number; z: number };
        const player = this.match.addGuard(
          'Guard',
          {
            x: spot.x,
            z: spot.z,
            yaw: Math.atan2(console_.x - spot.x, console_.z - spot.z) + Math.PI,
          },
          console_.y,
          s.weapon,
        );
        this.guards.push({
          player,
          vault,
          console: console_,
          beat,
          at: (n * 3) % beat.length,
          waitUntil: 0,
          alertUntil: 0,
          seen: undefined,
          npc: newNpcState(spot),
        });
      }
    }
  }

  /** Every tick: the guards near a player decide what to do and send their moves. */
  onTick(): void {
    if (!this.placed) this.place();
    const s = this.settings();
    const people = [...this.match.playerList()].filter((p) => !p.isDummy && p.alive);
    for (const g of this.guards) {
      if (!g.player.alive) continue;
      const awake = people.some(
        (p) => Math.hypot(p.body.x - g.player.body.x, p.body.z - g.player.body.z) <= s.activeRange,
      );
      if (!awake) continue;
      this.think(g, people, s);
    }
  }

  private think(g: Guard, people: readonly Player[], s: HeistSettings['guards']): void {
    const me = g.player.body;
    const tick = this.match.tick;
    const target = this.isBlind(g)
      ? undefined
      : nearestVisible(this.match, g.player, people, s.sightRange);
    let goal: { x: number; z: number } | undefined;
    let aim: { x: number; y: number; z: number } | undefined;
    let fire = false;

    if (target) {
      g.seen = { x: target.body.x, z: target.body.z, tick };
      aim = { x: target.body.x, y: target.body.y + CHEST, z: target.body.z };
      fire = true;
      // Close enough to shoot: hold, rather than charge.
      if (Math.hypot(target.body.x - me.x, target.body.z - me.z) > STAND_OFF)
        goal = { x: target.body.x, z: target.body.z };
    } else if (g.seen && tick - g.seen.tick < this.ticks(LOOK_SECONDS)) {
      goal = { x: g.seen.x, z: g.seen.z };
    } else if (tick < g.alertUntil) {
      // Alarm: hold the console, walking its ring slowly rather than standing in the open.
      goal = this.beatGoal(g, tick, 0.4);
    } else {
      goal = this.beatGoal(g, tick, 1.5);
    }
    if (goal && Math.hypot(goal.x - me.x, goal.z - me.z) <= ARRIVED) goal = undefined;

    const { stuck } = driveNpc(
      this.match,
      g.player,
      g.npc,
      { goal, speed: s.speed, aim, fire, aimErrorDegrees: s.aimErrorDegrees },
      this.rng,
    );
    // A guard that cannot get to its waypoint (a doorway the beat did not allow for) moves on.
    if (stuck) {
      g.at = (g.at + 1) % g.beat.length;
      g.npc.stillTicks = 0;
    }
  }

  /** Where the guard is walking on its beat (alert: the beat is tighter and slower). */
  private beatGoal(g: Guard, tick: number, wait: number): { x: number; z: number } {
    const here = g.beat[g.at] as { x: number; z: number };
    const me = g.player.body;
    if (Math.hypot(here.x - me.x, here.z - me.z) <= ARRIVED) {
      if (g.waitUntil === 0) g.waitUntil = tick + this.ticks(wait);
      if (tick >= g.waitUntil) {
        g.at = (g.at + 1) % g.beat.length;
        g.waitUntil = 0;
      }
    }
    return g.beat[g.at] as { x: number; z: number };
  }

  private ticks(seconds: number): number {
    return Math.round(seconds * this.match.tickRate);
  }
}
