import {
  Flag,
  WEAPON_IDS,
  findAnchor,
  type AudioSettings,
  type GameEvent,
  type GameMap,
  type VaultView,
  type VehicleKind,
  type VehicleSettings,
} from '@heist/shared';
import type { AudioOut, LoopHandle, Point } from './AudioEngine';
import { FootstepTracker, surfaceAt } from './Footsteps';
import type { SoundName } from './synth';

/** Somebody else, as last drawn. */
export interface HeardPlayer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly flags: number;
}

/** A car, as last known. */
export interface HeardCar {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly x: number;
  readonly z: number;
  readonly speed: number;
  readonly driver: number;
}

/** Everything audio needs to know about one frame. */
export interface HearingFrame {
  readonly dt: number;
  readonly listener: { readonly at: Point; readonly forward: Point; readonly up: Point };
  readonly me: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly onGround: boolean;
    readonly crouching: boolean;
    readonly alive: boolean;
    readonly driving: boolean;
  };
  readonly others: Iterable<HeardPlayer>;
  /** Players at the wheel (no footsteps: they sit in their cars). */
  readonly drivers: ReadonlySet<number>;
  readonly cars: Iterable<HeardCar>;
}

export interface GameAudioDeps {
  readonly out: AudioOut;
  readonly settings: AudioSettings;
  readonly vehicles: VehicleSettings;
  readonly map: GameMap;
  readonly myId: () => number;
  readonly positionOf: (id: number) => Point | undefined;
  /** Which gun another player holds (wire number, 0 = none). */
  readonly weaponOf: (id: number) => number;
  readonly random?: () => number;
}

/** Your own footsteps, a little under everyone else's so they do not tire. */
const OWN_STEP_VOLUME = 0.55;
/** Engine pitch: idle playback rate, and how much higher at top speed. */
const ENGINE_IDLE_RATE = 0.75;
const ENGINE_RATE_SPAN = 1.6;
/** Heavier impacts (m/s lost) give a full-volume crash. */
const CRASH_FULL = 12;
/** The empty-gun click repeats no faster than this (s) while the trigger is held. */
const DRY_FIRE_GAP = 0.3;
/** Far-off sirens: how far away (m), how loud and how long (s). */
const SIREN_DISTANCE = 140;
const SIREN_REACH = 60;
const SIREN_VOLUME = 0.6;
const SIREN_SECONDS = 9;
/** A gun is fired from about chest height. */
const GUN_HEIGHT = 1.4;

interface Alarm {
  readonly loop: LoopHandle | undefined;
  readonly at: Point;
  ends: number;
}

/**
 * What the game sounds like: turns game facts (shots, steps, cars, vaults,
 * cash) into sounds at the right place and loudness.
 * Pattern: Mediator — Why: combat, movement, cars and the heist each report
 * what happened in their own terms; this one place decides what is heard,
 * so none of them knows about audio and the sounds can be retuned alone.
 */
export class GameAudio {
  private time = 0;
  private readonly myFeet: FootstepTracker;
  private readonly feet = new Map<number, FootstepTracker>();
  private readonly engines = new Map<number, LoopHandle>();
  private readonly carSpeeds = new Map<number, number>();
  private readonly alarms = new Map<string, Alarm>();
  private vaultsSeen: Map<string, number> | undefined;
  private wind: LoopHandle | undefined;
  private siren: { loop: LoopHandle | undefined; ends: number } | undefined;
  private nextSiren: number;
  private lastDryFire = -Infinity;
  private hp: number | undefined;
  private purse: { carried: number; banked: number } | undefined;
  private listenerAt: Point = { x: 0, y: 0, z: 0 };
  private readonly random: () => number;

  constructor(private readonly deps: GameAudioDeps) {
    this.random = deps.random ?? Math.random;
    this.myFeet = new FootstepTracker(deps.settings);
    this.nextSiren = this.sirenGap();
  }

  /** Your own gun, heard at once (the server's echo of it is not played again). */
  localShot(weapon: string): void {
    this.deps.out.play(shotSound(weapon), { echo: true, rate: this.jitter(0.04) });
  }

  /** Trigger pulled on an empty gun. */
  dryFire(): void {
    if (this.time - this.lastDryFire < DRY_FIRE_GAP) return;
    this.lastDryFire = this.time;
    this.deps.out.play('dry-fire');
  }

  onEvent(event: GameEvent): void {
    if (event.e !== 'shot') return;
    if (event.shooter === this.deps.myId()) {
      if (event.hit !== 'miss') this.deps.out.play('hit', { rate: event.hit === 'head' ? 1.3 : 1 });
      return;
    }
    const from = this.deps.positionOf(event.shooter);
    if (!from) return;
    const weapon = WEAPON_IDS[this.deps.weaponOf(event.shooter) - 1] ?? 'pistol';
    this.deps.out.play(shotSound(weapon), {
      at: { x: from.x, y: from.y + GUN_HEIGHT, z: from.z },
      range: this.deps.settings.shotRange,
      reach: this.deps.settings.shotReach,
      echo: true,
      rate: this.jitter(0.04),
    });
  }

  /** Your own health from the server: losing some hurts. */
  onHealth(hp: number, alive: boolean): void {
    if (this.hp !== undefined && hp < this.hp && alive) this.deps.out.play('hurt');
    this.hp = hp;
  }

  /** Cash picked up or banked. */
  onPurse(carried: number, banked: number): void {
    const before = this.purse;
    this.purse = { carried, banked };
    if (!before) return;
    if (banked > before.banked) this.deps.out.play('bank');
    else if (carried > before.carried) this.deps.out.play('cash');
  }

  /** Vault progress: a newly cracked lock sets that bank's alarm ringing. */
  onVaults(vaults: readonly VaultView[]): void {
    const seen = this.vaultsSeen;
    this.vaultsSeen = new Map(vaults.map((v) => [v.id, v.opened]));
    if (!seen) return; // what was already open when we joined is not news
    for (const vault of vaults) {
      if (vault.opened <= (seen.get(vault.id) ?? 0)) continue;
      this.ring(vault.id);
    }
  }

  update(frame: HearingFrame): void {
    const { out, settings } = this.deps;
    this.time += frame.dt;
    this.listenerAt = frame.listener.at;
    out.setListener(frame.listener.at, frame.listener.forward, frame.listener.up);
    this.wind ??= out.loop('wind', { volume: settings.ambienceVolume });
    this.footsteps(frame);
    this.carSounds(frame.cars);
    this.alarmBells();
    this.distantSirens();
  }

  private footsteps(frame: HearingFrame): void {
    const { settings } = this.deps;
    const me = frame.me;
    if (me.alive && !me.driving && this.myFeet.update(me.x, me.z, me.onGround, frame.dt)) {
      this.step(me, me.crouching, OWN_STEP_VOLUME, undefined);
    }
    const heard = new Set<number>();
    for (const p of frame.others) {
      if ((p.flags & Flag.Alive) === 0 || frame.drivers.has(p.id)) continue;
      if (this.distance(p) > settings.footstepRange) continue;
      heard.add(p.id);
      let tracker = this.feet.get(p.id);
      if (!tracker) this.feet.set(p.id, (tracker = new FootstepTracker(settings)));
      const onGround = (p.flags & Flag.OnGround) !== 0;
      if (tracker.update(p.x, p.z, onGround, frame.dt))
        this.step(p, (p.flags & Flag.Crouching) !== 0, 1, settings.footstepRange);
    }
    // Out of earshot: forget them, so they start afresh when back.
    for (const id of this.feet.keys()) if (!heard.has(id)) this.feet.delete(id);
  }

  private step(at: Point, crouching: boolean, volume: number, range: number | undefined): void {
    const surface = surfaceAt(this.deps.map, at.x, at.y, at.z);
    this.deps.out.play(`step-${surface}`, {
      at,
      ...(range !== undefined ? { range } : {}),
      volume: volume * (crouching ? this.deps.settings.crouchStepVolume : 1),
      rate: this.jitter(0.06),
    });
  }

  /** Running engines (the nearest few), and a crash when a car suddenly loses speed. */
  private carSounds(cars: Iterable<HeardCar>): void {
    const { out, settings, vehicles } = this.deps;
    const running: { car: HeardCar; d: number }[] = [];
    const known = new Set<number>();
    for (const car of cars) {
      known.add(car.id);
      const at = { x: car.x, y: 0.6, z: car.z };
      const d = this.distance(at);
      const last = this.carSpeeds.get(car.id);
      this.carSpeeds.set(car.id, car.speed);
      const lost =
        last === undefined
          ? 0
          : Math.sign(last) !== Math.sign(car.speed) && car.speed !== 0
            ? Math.abs(last - car.speed)
            : Math.abs(last) - Math.abs(car.speed);
      if (lost >= settings.crashSpeedDrop && d <= settings.crashRange)
        out.play('crash', {
          at,
          range: settings.crashRange,
          reach: settings.crashReach,
          volume: Math.min(1, lost / CRASH_FULL),
        });
      if ((car.driver !== 0 || car.speed !== 0) && d <= settings.engineRange)
        running.push({ car, d });
    }
    for (const id of this.carSpeeds.keys()) if (!known.has(id)) this.carSpeeds.delete(id);
    running.sort((a, b) => a.d - b.d);
    const loud = new Set(running.slice(0, settings.maxEngines).map((r) => r.car.id));
    for (const [id, loop] of this.engines)
      if (!loud.has(id)) {
        loop.stop();
        this.engines.delete(id);
      }
    for (const { car } of running) {
      if (!loud.has(car.id)) continue;
      const at = { x: car.x, y: 0.6, z: car.z };
      const pace = Math.min(1, Math.abs(car.speed) / vehicles.kinds[car.kind].maxSpeed);
      let loop = this.engines.get(car.id);
      if (!loop) {
        loop = out.loop('engine', {
          at,
          range: settings.engineRange,
          reach: settings.engineReach,
          volume: 0.5,
        });
        if (!loop) continue;
        this.engines.set(car.id, loop);
      }
      loop.move(at);
      loop.setRate(ENGINE_IDLE_RATE + ENGINE_RATE_SPAN * pace);
      loop.setVolume(0.5 + 0.5 * pace);
    }
  }

  private ring(vaultId: string): void {
    const ends = this.time + this.deps.settings.alarmSeconds;
    const ringing = this.alarms.get(vaultId);
    if (ringing) {
      ringing.ends = ends;
      return;
    }
    const spec = this.deps.map.vaults?.find((v) => v.id === vaultId);
    const anchor = spec ? findAnchor(this.deps.map, spec.consoleId) : undefined;
    if (!anchor) return;
    const at = { x: anchor.x, y: anchor.y + 2, z: anchor.z };
    const loop = this.deps.out.loop('alarm', {
      at,
      range: this.deps.settings.alarmRange,
      reach: this.deps.settings.alarmReach,
      volume: this.alarmVolume(at),
    });
    this.alarms.set(vaultId, { loop, at, ends });
  }

  private alarmBells(): void {
    for (const [id, alarm] of this.alarms) {
      if (this.time >= alarm.ends) {
        alarm.loop?.stop();
        this.alarms.delete(id);
      } else alarm.loop?.setVolume(this.alarmVolume(alarm.at));
    }
  }

  /** Panners never fall fully silent; out of range the bell is turned right down. */
  private alarmVolume(at: Point): number {
    return this.distance(at) <= this.deps.settings.alarmRange ? 1 : 0;
  }

  /** Now and then a siren somewhere far off in the city, passing by. */
  private distantSirens(): void {
    if (this.siren && this.time >= this.siren.ends) {
      this.siren.loop?.stop();
      this.siren = undefined;
    }
    if (this.time < this.nextSiren) return;
    this.nextSiren = this.time + this.sirenGap();
    const angle = this.random() * Math.PI * 2;
    const l = this.listenerAt;
    const at = {
      x: l.x + Math.cos(angle) * SIREN_DISTANCE,
      y: 2,
      z: l.z + Math.sin(angle) * SIREN_DISTANCE,
    };
    this.siren?.loop?.stop();
    this.siren = {
      loop: this.deps.out.loop('siren', { at, reach: SIREN_REACH, volume: SIREN_VOLUME }),
      ends: this.time + SIREN_SECONDS,
    };
  }

  private sirenGap(): number {
    const { sirenMinSeconds: min, sirenMaxSeconds: max } = this.deps.settings;
    return min + this.random() * Math.max(0, max - min);
  }

  private distance(at: Point): number {
    const l = this.listenerAt;
    return Math.hypot(at.x - l.x, at.y - l.y, at.z - l.z);
  }

  /** A playback rate within ±`amount` of 1, so repeated sounds are never identical. */
  private jitter(amount: number): number {
    return 1 + (this.random() * 2 - 1) * amount;
  }
}

function shotSound(weapon: string): SoundName {
  return (WEAPON_IDS as readonly string[]).includes(weapon)
    ? (`shot-${weapon}` as SoundName)
    : 'shot-pistol';
}
