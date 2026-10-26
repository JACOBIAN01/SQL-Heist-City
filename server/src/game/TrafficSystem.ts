import {
  headingOf,
  laneCentre,
  laneGoing,
  mayEnter,
  safeSpeed,
  signalAt,
  turnLeft,
  turnRight,
  wrap,
  yawOf,
  type CityLayout,
  type DriveControls,
  type GameMap,
  type Lane,
  type Rng,
  type TrafficSettings,
  VEHICLE_KINDS,
} from '@heist/shared';
import type { Player } from './Player';
import type { Vehicle, VehicleFleet } from './VehicleFleet';

/** How far ahead of the car's front the junction's stop line is, and how close it dares to stop to one. */
const STOP_MARGIN = 1.5;
/** Cars (and people) within this many metres ahead, and this far to the side, are in the way. */
const LOOK_AHEAD = 16;
const LANE_HALF_WIDTH = 2.2;
const STEER_GAIN = 1.6;
/** A car that has not moved for this long (outside a light or a queue) is put back on the road. */
const STUCK_SECONDS = 20;
/** Speed lost in one tick that counts as hitting something. */
const CRASH_DROP = 4;

interface Driver {
  readonly car: Vehicle;
  lane: Lane;
  /** The junction (i, j) the car is heading for, and what it plans to do there. */
  turn: 'straight' | 'left' | 'right' | undefined;
  turnFor: string;
  crashedUntil: number;
  stillSince: number;
  lastSpeed: number;
}

/**
 * The city's traffic (Phase 29.2): cars that drive themselves. Each keeps to the right-hand lane
 * of a street, slows for the car or person in front, stops at a red light, takes a turn at some
 * junctions, and stands still for a few seconds after a crash. They use the same physics as a
 * player's car, so the server's cars and the clients' pictures agree, and they only move while a
 * player is near. A player who takes the wheel of one makes it an ordinary car.
 *
 * Pattern: Strategy-free controller — Why: the rules of the road are pure functions in shared/
 * (lanes, turns, signals, stopping distance); this class only reads the world and applies them.
 */
export class TrafficSystem {
  private readonly drivers: Driver[] = [];
  private readonly lines: { x: readonly number[]; z: readonly number[] };
  private readonly offset: number;

  constructor(
    private readonly fleet: VehicleFleet,
    private readonly city: CityLayout,
    private readonly settings: () => TrafficSettings,
    private readonly rng: Rng,
  ) {
    this.lines = { x: city.streetLinesX, z: city.streetLinesZ };
    this.offset = city.settings.streetWidth / 4;
    this.populate(settings().count);
  }

  get count(): number {
    return this.drivers.length;
  }

  /** Puts `count` cars on lanes, well apart from one another. */
  private populate(count: number): void {
    const homes: { x: number; z: number }[] = [];
    for (let n = 0, tries = 0; n < count && tries < count * 40; tries++) {
      const lane = this.randomLane();
      const along = this.randomAlong();
      const centre = laneCentre(lane, this.lines, this.offset);
      const at = lane.vertical ? { x: centre, z: along } : { x: along, z: centre };
      if (homes.some((h) => Math.hypot(h.x - at.x, h.z - at.z) < 14)) continue;
      homes.push(at);
      const v = headingOf(lane);
      const car = this.fleet.addTraffic({
        x: at.x,
        z: at.z,
        yaw: yawOf(v),
        kind: VEHICLE_KINDS[this.rng.int(0, VEHICLE_KINDS.length - 1)] as 'sedan',
        variant: this.rng.int(0, 7),
      });
      this.drivers.push({
        car,
        lane,
        turn: undefined,
        turnFor: '',
        crashedUntil: 0,
        stillSince: -1,
        lastSpeed: 0,
      });
      n++;
    }
  }

  private randomLane(): Lane {
    const vertical = this.rng.bool(0.5);
    const lines = vertical ? this.lines.x : this.lines.z;
    return { vertical, line: this.rng.int(0, lines.length - 1), dir: this.rng.bool(0.5) ? 1 : -1 };
  }

  private randomAlong(): number {
    const reach = this.city.halfSize - 20;
    return this.rng.next() * 2 * reach - reach;
  }

  /** Every tick, for the cars near a player. `time` is match seconds. */
  tick(map: GameMap, players: Iterable<Player>, time: number): void {
    const s = this.settings();
    const watchers = [...players].filter((p) => !p.isDummy);
    for (const d of this.drivers) {
      const car = d.car;
      if (car.driver !== 0) car.ai = false; // a player took the wheel: it is theirs now
      if (!car.ai) continue;
      if (
        !watchers.some(
          (p) => Math.hypot(p.body.x - car.state.x, p.body.z - car.state.z) <= s.activeRange,
        )
      )
        continue;
      this.drive(d, map, watchers, time, s);
    }
  }

  private drive(
    d: Driver,
    map: GameMap,
    people: readonly Player[],
    time: number,
    s: TrafficSettings,
  ): void {
    const car = d.car;
    const st = car.state;
    // Something hit us since our last move (another car's drive shoves us): that is a crash too.
    if (d.lastSpeed - st.speed > CRASH_DROP && time >= d.crashedUntil)
      d.crashedUntil = time + s.crashSeconds;
    // A crash: stand still with the brake on until the time is up.
    if (time < d.crashedUntil) {
      this.fleet.drive(car, { throttle: 0, steer: 0, handbrake: true }, map);
      d.lastSpeed = st.speed;
      return;
    }
    const heading = headingOf(d.lane);
    const along = d.lane.vertical ? st.z : st.x;
    const across = d.lane.vertical ? st.x : st.z;
    const centre = laneCentre(d.lane, this.lines, this.offset);
    const half = car.spec.length / 2;

    // The junction ahead, and how far its stop line is.
    const crossings = d.lane.vertical ? this.lines.z : this.lines.x;
    const index = this.nextCrossing(crossings, along, d.lane.dir);
    let target = s.cruiseSpeed;
    if (index === undefined) {
      // The end of the street: turn round into the other lane of it.
      if (Math.abs(along) > this.city.halfSize - 14) this.uTurn(d);
    } else {
      const at = crossings[index] as number;
      const toCentre = (at - along) * d.lane.dir;
      const gap = toCentre - this.city.settings.streetWidth / 2 - half - STOP_MARGIN;
      const i = d.lane.vertical ? d.lane.line : index;
      const j = d.lane.vertical ? index : d.lane.line;
      const key = `${i},${j}`;
      if (d.turnFor !== key) {
        d.turnFor = key;
        d.turn = this.chooseTurn(i, j, d.lane);
      }
      const signal = signalAt(time, i, j, s);
      // A red light (or a clearing junction) stops the car at the line; one already in the junction goes on.
      if (!mayEnter(d.lane, signal) && gap > -half)
        target = Math.min(target, safeSpeed(gap, s.comfortBrake));
      // At the middle of the junction the car takes its turn onto the new street's lane.
      if (toCentre <= 1.2 && d.turn && d.turn !== 'straight') this.turnAt(d, i, j);
    }
    target = Math.min(target, this.followLimit(d, heading, people, s));

    // Steer for a point ahead on the lane; the throttle chases the target speed.
    const look = 4 + 0.6 * Math.abs(st.speed);
    const aim = d.lane.vertical
      ? { x: centre, z: along + d.lane.dir * look }
      : { x: along + d.lane.dir * look, z: centre };
    const want = yawOf({ x: aim.x - st.x, z: aim.z - st.z });
    const error = wrap(want - st.yaw);
    const controls: DriveControls = {
      throttle: Math.max(-1, Math.min(1, (target - st.speed) * 0.8)),
      steer: -Math.max(-1, Math.min(1, STEER_GAIN * error)),
      handbrake: false,
    };
    void across;
    const before = st.speed;
    this.fleet.drive(car, controls, map);
    // Hitting something takes speed away that the throttle did not ask to lose.
    if (before - st.speed > CRASH_DROP && controls.throttle >= -0.2)
      d.crashedUntil = time + s.crashSeconds;
    this.watchForStuck(d, map, people, time);
    d.lastSpeed = st.speed;
  }

  /** The next junction in the direction of travel, ahead of the car's middle. */
  private nextCrossing(lines: readonly number[], along: number, dir: 1 | -1): number | undefined {
    let best: number | undefined;
    lines.forEach((value, i) => {
      const ahead = (value - along) * dir;
      if (
        ahead > -this.city.settings.streetWidth / 2 &&
        (best === undefined || ahead < ((lines[best] as number) - along) * dir)
      )
        best = i;
    });
    return best;
  }

  /** What to do at a junction: mostly straight on, sometimes left or right where there is a street. */
  private chooseTurn(i: number, j: number, lane: Lane): 'straight' | 'left' | 'right' {
    const here = headingOf(lane);
    const exists = (v: { x: number; z: number }): boolean => {
      // A street on that side exists unless this junction is at the end of the cross street.
      const next = laneGoing(v, i, j);
      const lines = next.vertical ? this.lines.x : this.lines.z;
      return next.line >= 0 && next.line < lines.length;
    };
    const options: ('straight' | 'left' | 'right')[] = ['straight', 'straight', 'straight'];
    if (exists(turnLeft(here))) options.push('left');
    if (exists(turnRight(here))) options.push('right');
    return options[this.rng.int(0, options.length - 1)] as 'straight';
  }

  private turnAt(d: Driver, i: number, j: number): void {
    const here = headingOf(d.lane);
    const v = d.turn === 'left' ? turnLeft(here) : turnRight(here);
    d.lane = laneGoing(v, i, j);
    d.turn = undefined;
    d.turnFor = '';
  }

  private uTurn(d: Driver): void {
    d.lane = { ...d.lane, dir: d.lane.dir === 1 ? -1 : 1 };
    d.turn = undefined;
    d.turnFor = '';
  }

  /** The highest speed that still lets the car stop behind whatever is in front of it. */
  private followLimit(
    d: Driver,
    heading: { x: number; z: number },
    people: readonly Player[],
    s: TrafficSettings,
  ): number {
    const car = d.car;
    const reach = car.spec.length / 2;
    let nearest = Infinity;
    const consider = (x: number, z: number, radius: number) => {
      const dx = x - car.state.x;
      const dz = z - car.state.z;
      const ahead = dx * heading.x + dz * heading.z;
      const side = Math.abs(dx * -heading.z + dz * heading.x);
      if (ahead <= 0 || ahead > LOOK_AHEAD + radius || side > LANE_HALF_WIDTH + radius * 0.5)
        return;
      nearest = Math.min(nearest, ahead - reach - radius);
    };
    for (const other of this.fleet.all()) {
      if (other === car) continue;
      consider(other.state.x, other.state.z, other.spec.length / 2);
    }
    for (const p of people) if (p.alive && p.vehicleId === 0) consider(p.body.x, p.body.z, 0.4);
    return nearest === Infinity ? s.cruiseSpeed : safeSpeed(nearest - 2, s.comfortBrake);
  }

  /** A car that is going nowhere is put back on its lane, where nobody is looking. */
  private watchForStuck(d: Driver, map: GameMap, people: readonly Player[], time: number): void {
    const st = d.car.state;
    if (Math.abs(st.speed) > 0.3) {
      d.stillSince = -1;
      return;
    }
    if (d.stillSince < 0) d.stillSince = time;
    if (time - d.stillSince < STUCK_SECONDS) return;
    // Only out of sight: nobody sees a car vanish.
    if (people.some((p) => Math.hypot(p.body.x - st.x, p.body.z - st.z) < 60)) return;
    const centre = laneCentre(d.lane, this.lines, this.offset);
    if (d.lane.vertical) st.x = centre;
    else st.z = centre;
    st.yaw = yawOf(headingOf(d.lane));
    st.speed = 0;
    d.stillSince = -1;
    void map;
  }
}
