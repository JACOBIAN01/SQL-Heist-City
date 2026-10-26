import {
  Button,
  findAnchor,
  raycastMap,
  type GameMap,
  type HeistSettings,
  type InputCommand,
  type MapAnchor,
  type MapVault,
  type Rng,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** Eye height for lines of sight, and the height of the chest guards aim at (m above the floor). */
const EYE = 1.5;
const CHEST = 1.2;
/** Guards close to this distance (m) on a target, and no further: they shoot, they do not charge. */
const STAND_OFF = 7;
/** Arrived, for a waypoint or the console (m). */
const ARRIVED = 1.2;
/** Seconds a guard keeps looking where it last saw someone. */
const LOOK_SECONDS = 4;
/** Ticks without moving, while trying to, before the guard gives up on that waypoint. */
const STUCK_TICKS = 25;
/** The vertical gap (m) beyond which a guard cannot see a player: another floor. */
const SAME_FLOOR = 2.5;

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
  stillTicks: number;
  last: { x: number; z: number };
  seq: number;
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

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => HeistSettings['guards'],
    events: HeistEvents,
    private readonly rng: Rng,
  ) {
    events.subscribe((event) => {
      if (event.type !== 'lock_opened') return;
      const until = this.match.tick + this.ticks(this.settings().alertSeconds);
      for (const g of this.guards) if (g.vault.id === event.vault.spec.id) g.alertUntil = until;
    });
  }

  get count(): number {
    return this.guards.length;
  }

  /** The guards, for tests and the debug overlay. */
  all(): readonly Player[] {
    return this.guards.map((g) => g.player);
  }

  /** A new round: the alarm is over and every guard is back on its beat. */
  reset(): void {
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
          stillTicks: 0,
          last: { x: spot.x, z: spot.z },
          seq: 0,
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
    const target = this.nearestVisible(g, people, s.sightRange);
    let goal: { x: number; z: number } | undefined;
    let aim: { x: number; y: number; z: number } | undefined;
    let fire = false;
    let hold = false;

    if (target) {
      g.seen = { x: target.body.x, z: target.body.z, tick };
      aim = { x: target.body.x, y: target.body.y + CHEST, z: target.body.z };
      const d = Math.hypot(target.body.x - me.x, target.body.z - me.z);
      fire = true;
      if (d > STAND_OFF) goal = { x: target.body.x, z: target.body.z };
      else hold = true;
    } else if (g.seen && tick - g.seen.tick < this.ticks(LOOK_SECONDS)) {
      goal = { x: g.seen.x, z: g.seen.z };
    } else if (tick < g.alertUntil) {
      // Alarm: hold the console, walking its ring slowly rather than standing in the open.
      goal = this.beatGoal(g, tick, 0.4);
    } else {
      goal = this.beatGoal(g, tick, 1.5);
    }

    const forward = goal && Math.hypot(goal.x - me.x, goal.z - me.z) > ARRIVED && !hold;
    const face = aim ?? goal ?? { x: me.x, z: me.z };
    const dx = face.x - me.x;
    const dz = face.z - me.z;
    const horizontal = Math.hypot(dx, dz);
    // Aim wanders a little, so a guard is dangerous but not deadly.
    const wander = (s.aimErrorDegrees * Math.PI) / 180;
    const yaw =
      horizontal > 0.01
        ? Math.atan2(-dx, -dz) + (aim ? (this.rng.next() * 2 - 1) * wander : 0)
        : g.player.yaw;
    const pitch = aim ? Math.atan2(aim.y - (me.y + EYE), Math.max(0.1, horizontal)) : 0;
    this.trackProgress(g, forward ?? false);

    const commands: InputCommand[] = [];
    const n = Math.max(1, Math.round(60 / this.match.tickRate));
    for (let i = 0; i < n; i++)
      commands.push({
        seq: (g.seq = (g.seq + 1) & 0xffff),
        moveX: 0,
        moveY: forward ? Math.round(127 * s.speed) : 0,
        yaw,
        pitch,
        buttons: fire ? Button.Fire : 0,
        viewLagMs: 0,
      });
    this.match.drive(g.player, commands);
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

  /** A guard that cannot get to its waypoint (a doorway the beat did not allow for) moves on to the next. */
  private trackProgress(g: Guard, wantsToMove: boolean): void {
    const me = g.player.body;
    const moved = Math.hypot(me.x - g.last.x, me.z - g.last.z);
    g.last = { x: me.x, z: me.z };
    g.stillTicks = wantsToMove && moved < 0.02 ? g.stillTicks + 1 : 0;
    if (g.stillTicks > STUCK_TICKS) {
      g.at = (g.at + 1) % g.beat.length;
      g.stillTicks = 0;
    }
  }

  /** The nearest living player the guard can see: close enough, on its floor, with nothing in the way. */
  private nearestVisible(g: Guard, people: readonly Player[], range: number): Player | undefined {
    const me = g.player.body;
    let best: Player | undefined;
    let bestD = Infinity;
    for (const p of people) {
      if (Math.abs(p.body.y - me.y) > SAME_FLOOR) continue;
      const dx = p.body.x - me.x;
      const dz = p.body.z - me.z;
      const dy = p.body.y + CHEST - (me.y + EYE);
      const d = Math.hypot(dx, dz);
      if (d > range || d >= bestD) continue;
      const len = Math.hypot(dx, dy, dz) || 1;
      const wall = raycastMap(
        this.match.map,
        me.x,
        me.y + EYE,
        me.z,
        dx / len,
        dy / len,
        dz / len,
        len,
      );
      if (wall !== undefined && wall < len - 0.3) continue;
      best = p;
      bestD = d;
    }
    return best;
  }

  private ticks(seconds: number): number {
    return Math.round(seconds * this.match.tickRate);
  }
}
