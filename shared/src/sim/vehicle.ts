import type { MovementSettings } from '../config/movement';
import type { VehicleSpec } from '../config/vehicles';
import { colliderGridFor } from '../world/ColliderGrid';
import type { Aabb, GameMap } from '../world/map';
import { Button, hasButton, type InputCommand } from './input';
import { bodyHeight, type BodyState } from './movement';

/** A car on the ground. Plain data, so it can be copied, replayed and sent. */
export interface VehicleState {
  x: number;
  z: number;
  /** Radians; 0 faces −z, like a player. */
  yaw: number;
  /** Along the car's forward, m/s; negative in reverse. */
  speed: number;
  /** Front-wheel angle, rad; positive turns left (counter-clockwise from above). */
  steer: number;
}

export function createVehicle(x: number, z: number, yaw = 0): VehicleState {
  return { x, z, yaw, speed: 0, steer: 0 };
}

/** What a driver asks for this step, from the same input a player sends on foot. */
export interface DriveControls {
  /** −1 (reverse / brake) … 1 (throttle). */
  readonly throttle: number;
  /** −1 (left) … 1 (right). */
  readonly steer: number;
  readonly handbrake: boolean;
}

/** On foot, W/S and A/D move; in a car they are throttle and steering, and Jump is the handbrake. */
export function controlsOf(cmd: InputCommand): DriveControls {
  return {
    throttle: cmd.moveY / 127,
    steer: cmd.moveX / 127,
    handbrake: hasButton(cmd.buttons, Button.Jump),
  };
}

/** Boxes lower than this pass under the car (kerbs); taller ones stop it. */
export const VEHICLE_CLEARANCE = 0.3;
/** Boxes starting above this pass over it (it is under them). */
const VEHICLE_ROOF = 1.4;
const MAX_PUSHES = 4;
/** Hits squarer than this (cosine) bounce the car back; shallower ones scrape along the wall. */
const HEAD_ON = 0.7;
/** How fast a scrape slows the car, per second at a square-on scrape. */
const SCRAPE = 3;
const EPS = 1e-6;

const toward = (value: number, target: number, step: number) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);

/**
 * One fixed step of driving: pedals and steering, a bicycle model for the
 * turn, then collisions of the car's footprint against the map. Pure and
 * deterministic like stepBody, so the server can run it authoritatively and
 * a client can predict it.
 */
export function stepVehicle(
  car: VehicleState,
  controls: DriveControls,
  dt: number,
  map: GameMap,
  spec: VehicleSpec,
): void {
  // Steering: wheels turn toward the stick at steerSpeed, with less lock the faster you go.
  const pace = Math.min(1, Math.abs(car.speed) / spec.maxSpeed);
  const lock = spec.maxSteer * (1 - (1 - spec.highSpeedSteer) * pace);
  car.steer = toward(car.steer, -controls.steer * lock, spec.steerSpeed * dt);

  // Pedals: throttle against the motion brakes first, then drives the other way.
  const t = Math.max(-1, Math.min(1, controls.throttle));
  if (controls.handbrake) car.speed = toward(car.speed, 0, spec.brake * dt);
  else if (t > 0) {
    car.speed =
      car.speed < -0.1
        ? toward(car.speed, 0, spec.brake * t * dt)
        : Math.min(spec.maxSpeed, car.speed + spec.accel * t * dt);
  } else if (t < 0) {
    car.speed =
      car.speed > 0.1
        ? toward(car.speed, 0, spec.brake * -t * dt)
        : Math.max(-spec.reverseSpeed, car.speed + spec.accel * t * dt);
  } else car.speed = toward(car.speed, 0, spec.coast * dt);

  // Bicycle model: the car turns about its rear axle at speed · tan(steer) / wheelBase.
  car.yaw += ((car.speed * Math.tan(car.steer)) / spec.wheelBase) * dt;
  car.x += -Math.sin(car.yaw) * car.speed * dt;
  car.z += -Math.cos(car.yaw) * car.speed * dt;

  collide(car, map, spec, dt);
}

const near: Aabb[] = [];

/** Pushes the car's footprint out of any box it overlaps, and bounces it off. */
function collide(car: VehicleState, map: GameMap, spec: VehicleSpec, dt: number): void {
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  for (let pass = 0; pass < MAX_PUSHES; pass++) {
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    // Footprint corners' reach on each world axis.
    const ex = Math.abs(fx) * hl + Math.abs(fz) * hw;
    const ez = Math.abs(fz) * hl + Math.abs(fx) * hw;
    const n = colliderGridFor(map).query(car.x - ex, car.z - ez, car.x + ex, car.z + ez, near);
    let pushed = false;
    for (let i = 0; i < n; i++) {
      const b = near[i] as Aabb;
      if (b.maxY <= VEHICLE_CLEARANCE || b.minY >= VEHICLE_ROOF) continue;
      const mtv = separate(car.x, car.z, fx, fz, hl, hw, ex, ez, b);
      if (!mtv) continue;
      car.x += mtv.x;
      car.z += mtv.z;
      // How square-on the car meets the wall: 1 head-on, 0 grazing along it.
      const len = Math.hypot(mtv.x, mtv.z) || 1;
      const impact = -(Math.sign(car.speed) * (fx * mtv.x + fz * mtv.z)) / len;
      if (impact > HEAD_ON) car.speed = -car.speed * spec.bounce;
      // A glancing hit scrapes along (the push keeps it outside) and bleeds speed.
      else if (impact > 0) car.speed *= Math.max(0, 1 - impact * SCRAPE * dt);
      pushed = true;
    }
    if (!pushed) return;
  }
}

/**
 * Smallest push that separates the car's footprint (an oriented rectangle)
 * from a box's footprint, by the separating-axis test on the four candidate
 * axes (the world's x and z, the car's forward and right). Undefined if they
 * do not overlap.
 */
function separate(
  cx: number,
  cz: number,
  fx: number,
  fz: number,
  hl: number,
  hw: number,
  ex: number,
  ez: number,
  b: Aabb,
): { x: number; z: number } | undefined {
  const bx = (b.minX + b.maxX) / 2;
  const bz = (b.minZ + b.maxZ) / 2;
  const bhx = (b.maxX - b.minX) / 2;
  const bhz = (b.maxZ - b.minZ) / 2;
  const dx = cx - bx;
  const dz = cz - bz;
  let best = Infinity;
  let ax = 0;
  let az = 0;
  // World x and z: the car's extent is (ex, ez).
  const ox = ex + bhx - Math.abs(dx);
  if (ox <= EPS) return undefined;
  if (ox < best) [best, ax, az] = [ox, Math.sign(dx) || 1, 0];
  const oz = ez + bhz - Math.abs(dz);
  if (oz <= EPS) return undefined;
  if (oz < best) [best, ax, az] = [oz, 0, Math.sign(dz) || 1];
  // The car's own axes: the box projects to |axis.x|·bhx + |axis.z|·bhz.
  for (const [ux, uz, half] of [
    [fx, fz, hl],
    [-fz, fx, hw],
  ] as const) {
    const d = dx * ux + dz * uz;
    const o = half + Math.abs(ux) * bhx + Math.abs(uz) * bhz - Math.abs(d);
    if (o <= EPS) return undefined;
    if (o < best) [best, ax, az] = [o, ux * (Math.sign(d) || 1), uz * (Math.sign(d) || 1)];
  }
  return { x: ax * best, z: az * best };
}

/** Distance (m) from (x, z) to the nearest point of a car's footprint; 0 on or inside it. */
export function distanceToCar(car: VehicleState, spec: VehicleSpec, x: number, z: number): number {
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  const dx = x - car.x;
  const dz = z - car.z;
  // Into the car's frame: along its forward and its right.
  const along = dx * fx + dz * fz;
  const across = dx * -fz + dz * fx;
  const ox = Math.max(0, Math.abs(along) - spec.length / 2);
  const oz = Math.max(0, Math.abs(across) - spec.width / 2);
  return Math.hypot(ox, oz);
}

/** A car as something to bump into: where it stands and how big it is. */
export interface CarFootprint {
  readonly state: VehicleState;
  readonly spec: VehicleSpec;
}

/** Bodies standing this high or higher (an upper floor) are above every car. */
const BODY_ABOVE_CARS = VEHICLE_ROOF;
const BODY_GAP = 1e-4;
const bodyNear: Aabb[] = [];

/**
 * Pushes a body (a circle of `radius` on the ground plane) out of every car
 * footprint it overlaps, after its movement step: cars are solid, but they
 * move, so they cannot live in the static collision map. A push that would
 * shove the body into a wall is skipped (the car scrapes past instead), so a
 * body is never wedged inside the map. Shared by server and client
 * prediction, like stepBody. Returns whether the body moved.
 */
export function pushBodyOutOfCars(
  body: BodyState,
  cfg: MovementSettings,
  cars: Iterable<CarFootprint>,
  map: GameMap,
): boolean {
  if (body.y >= BODY_ABOVE_CARS) return false;
  const radius = cfg.radius;
  const height = bodyHeight(body, cfg);
  let moved = false;
  for (const { state: car, spec } of cars) {
    const reach = (spec.length + spec.width) / 2 + radius;
    if (Math.abs(car.x - body.x) > reach || Math.abs(car.z - body.z) > reach) continue;
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const dx = body.x - car.x;
    const dz = body.z - car.z;
    // Into the car's frame: along its forward and its right (−fz, fx).
    const along = dx * fx + dz * fz;
    const across = dx * -fz + dz * fx;
    const hl = spec.length / 2;
    const hw = spec.width / 2;
    const ca = Math.max(-hl, Math.min(hl, along));
    const cc = Math.max(-hw, Math.min(hw, across));
    let na = along - ca;
    let nc = across - cc;
    const d = Math.hypot(na, nc);
    if (d >= radius) continue;
    let push: number;
    if (d > 1e-9) {
      na /= d;
      nc /= d;
      push = radius - d + BODY_GAP;
    } else {
      // The centre is inside the footprint: leave by the nearest side.
      const outA = hl - Math.abs(along);
      const outC = hw - Math.abs(across);
      if (outA < outC) [na, nc, push] = [Math.sign(along) || 1, 0, outA + radius + BODY_GAP];
      else [na, nc, push] = [0, Math.sign(across) || 1, outC + radius + BODY_GAP];
    }
    // Back to world axes.
    const wx = (na * fx - nc * fz) * push;
    const wz = (na * fz + nc * fx) * push;
    if (blockedByMap(map, body.x + wx, body.y, body.z + wz, radius, height, cfg.stepHeight))
      continue;
    body.x += wx;
    body.z += wz;
    // Lose the speed that was driving into the car.
    const nx = wx / push;
    const nz = wz / push;
    const into = body.vx * nx + body.vz * nz;
    if (into < 0) {
      body.vx -= into * nx;
      body.vz -= into * nz;
    }
    moved = true;
  }
  return moved;
}

function blockedByMap(
  map: GameMap,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  /** Ledges this low (a kerb) do not block: the next movement step climbs them. */
  stepHeight: number,
): boolean {
  const n = colliderGridFor(map).query(x - r, z - r, x + r, z + r, bodyNear);
  for (let i = 0; i < n; i++) {
    const b = bodyNear[i] as Aabb;
    if (
      b.maxY - y > stepHeight &&
      x - r < b.maxX &&
      x + r > b.minX &&
      y < b.maxY &&
      y + h > b.minY &&
      z - r < b.maxZ &&
      z + r > b.minZ
    ) {
      return true;
    }
  }
  return false;
}

/** How far from the car's side a driver steps out, m. */
const EXIT_GAP = 0.8;

/**
 * Where a driver may step out, best first: the driver's door (left), the
 * other door, behind, in front. The server takes the first that is free.
 */
export function exitSpots(car: VehicleState, spec: VehicleSpec): { x: number; z: number }[] {
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  // The car's right is its forward turned clockwise: (−fz, fx).
  const rx = -fz;
  const rz = fx;
  const side = spec.width / 2 + EXIT_GAP;
  const end = spec.length / 2 + EXIT_GAP;
  return [
    { x: car.x - rx * side, z: car.z - rz * side },
    { x: car.x + rx * side, z: car.z + rz * side },
    { x: car.x - fx * end, z: car.z - fz * end },
    { x: car.x + fx * end, z: car.z + fz * end },
  ];
}

/**
 * Pushes car `a` out of car `b` (both footprints are oriented rectangles) and
 * bounces it, like a wall would; true if they touched. The caller decides
 * which car moves (the one that drove into the other).
 */
export function collideCars(
  a: VehicleState,
  specA: VehicleSpec,
  b: VehicleState,
  specB: VehicleSpec,
): boolean {
  const mtv = separateRects(a, specA, b, specB);
  if (!mtv) return false;
  a.x += mtv.x;
  a.z += mtv.z;
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  const len = Math.hypot(mtv.x, mtv.z) || 1;
  const impact = -(Math.sign(a.speed) * (fx * mtv.x + fz * mtv.z)) / len;
  if (impact > HEAD_ON) {
    // Some of the shove goes into the other car, the rest bounces back.
    b.speed += a.speed * 0.3;
    a.speed = -a.speed * specA.bounce;
  } else if (impact > 0) a.speed *= 1 - impact * 0.1;
  return true;
}

/** Separating-axis test between two oriented rectangles; the push that moves `a` out of `b`. */
function separateRects(
  a: VehicleState,
  specA: VehicleSpec,
  b: VehicleState,
  specB: VehicleSpec,
): { x: number; z: number } | undefined {
  const axesOf = (yaw: number) => {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return [
      [fx, fz],
      [-fz, fx],
    ] as const;
  };
  const extent = (yaw: number, spec: VehicleSpec, ux: number, uz: number) => {
    const [[fx, fz], [rx, rz]] = axesOf(yaw);
    return (
      Math.abs(fx * ux + fz * uz) * (spec.length / 2) +
      Math.abs(rx * ux + rz * uz) * (spec.width / 2)
    );
  };
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  let best = Infinity;
  let px = 0;
  let pz = 0;
  for (const [ux, uz] of [...axesOf(a.yaw), ...axesOf(b.yaw)]) {
    const d = dx * ux + dz * uz;
    const overlap = extent(a.yaw, specA, ux, uz) + extent(b.yaw, specB, ux, uz) - Math.abs(d);
    if (overlap <= EPS) return undefined;
    if (overlap < best) {
      best = overlap;
      const sign = Math.sign(d) || 1;
      px = ux * sign;
      pz = uz * sign;
    }
  }
  return { x: px * best, z: pz * best };
}
