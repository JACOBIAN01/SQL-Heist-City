import type { Scene } from 'three';
import {
  distanceToCar,
  type CarFootprint,
  type VehicleKind,
  type VehicleSettings,
  type VehicleWire,
} from '@heist/shared';
import type { CarAssets } from './carAssets';
import type { CarModel } from './CarModel';

/** Which model draws each kind; a car's variant picks among them. */
export const MODELS_FOR: Readonly<Record<VehicleKind, readonly string[]>> = {
  sedan: ['NormalCar1', 'NormalCar2', 'Taxi', 'Cop'],
  sports: ['SportsCar', 'SportsCar2'],
  suv: ['SUV'],
};

export function modelFor(kind: VehicleKind, variant: number): string {
  const models = MODELS_FOR[kind];
  return models[variant % models.length] ?? models[0] ?? 'NormalCar1';
}

/** Cars further than this from the camera are not drawn (the fog has mostly hidden them). */
const DRAW_DISTANCE = 110;
const MAX_SAMPLES = 8;

interface Sample {
  readonly t: number;
  readonly car: VehicleWire;
}

interface Tracked {
  latest: VehicleWire;
  readonly samples: Sample[];
  model: CarModel | undefined;
  drawn: { x: number; z: number };
}

const lerpAngle = (a: number, b: number, t: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * Every car the server tells this client about, drawn in the past and
 * blended between snapshots like other players. The car the local player
 * drives is drawn by its prediction instead (see PredictedVehicle).
 */
export class RemoteVehicles {
  private readonly cars = new Map<number, Tracked>();
  private readonly solid = new Map<number, CarFootprint>();
  private assets: CarAssets | undefined;
  /** The car the local player drives (drawn by prediction, not here). */
  ownId = 0;

  constructor(
    private readonly scene: Scene,
    private readonly settings: VehicleSettings,
  ) {}

  /** Models can arrive after the first snapshots; cars seen before then get theirs now. */
  setAssets(assets: CarAssets): void {
    this.assets = assets;
    for (const tracked of this.cars.values()) this.ensureModel(tracked);
  }

  get count(): number {
    return this.cars.size;
  }

  onSnapshot(
    serverTimeMs: number,
    vehicles: readonly VehicleWire[],
    removed: readonly number[],
  ): void {
    for (const car of vehicles) {
      let tracked = this.cars.get(car.id);
      if (!tracked) {
        tracked = { latest: car, samples: [], model: undefined, drawn: { x: car.x, z: car.z } };
        this.cars.set(car.id, tracked);
        this.ensureModel(tracked);
      }
      tracked.latest = car;
      this.solid.set(car.id, { state: car, spec: this.settings.kinds[car.kind] });
      tracked.samples.push({ t: serverTimeMs, car });
      if (tracked.samples.length > MAX_SAMPLES) tracked.samples.shift();
    }
    for (const id of removed) {
      const tracked = this.cars.get(id);
      if (tracked?.model) this.scene.remove(tracked.model.object);
      this.cars.delete(id);
      this.solid.delete(id);
    }
  }

  /** The newest state the server sent for a car (what a driver's prediction rewinds to). */
  latest(id: number): VehicleWire | undefined {
    return this.cars.get(id)?.latest;
  }

  modelOf(id: number): CarModel | undefined {
    return this.cars.get(id)?.model;
  }

  /**
   * Every car as the server last placed it, for the local player to bump into.
   * The newest state, not the drawn (past) one: the server collides against
   * where cars are now, and prediction should agree with it.
   */
  footprints(): Iterable<CarFootprint> {
    // A live view: each walk sees the cars as they are then.
    return { [Symbol.iterator]: () => this.solid.values() };
  }

  /** Every car's newest state from the server. */
  *states(): IterableIterator<VehicleWire> {
    for (const { latest } of this.cars.values()) yield latest;
  }

  /** Players at the wheel of a car: their bodies are hidden inside it. */
  drivers(out: Set<number>): Set<number> {
    out.clear();
    for (const { latest } of this.cars.values()) if (latest.driver) out.add(latest.driver);
    return out;
  }

  /** The nearest empty car whose side is within reach of (x, z), if any. */
  freeCarNear(x: number, z: number): VehicleWire | undefined {
    let best: VehicleWire | undefined;
    let bestDistance = Infinity;
    for (const { latest } of this.cars.values()) {
      if (latest.driver !== 0) continue;
      const d = distanceToCar(latest, this.settings.kinds[latest.kind], x, z);
      if (d <= this.settings.enterRange && d < bestDistance) [best, bestDistance] = [latest, d];
    }
    return best;
  }

  /** Draws every car `delayMs` in the past, blended between the two samples around that time. */
  update(serverTimeMs: number, delayMs: number, viewer: { x: number; z: number }): void {
    const at = serverTimeMs - delayMs;
    for (const [id, tracked] of this.cars) {
      const model = tracked.model;
      if (!model) continue;
      if (id === this.ownId) continue; // drawn by prediction
      const pose = sample(tracked.samples, at) ?? tracked.latest;
      model.object.visible = Math.hypot(pose.x - viewer.x, pose.z - viewer.z) < DRAW_DISTANCE;
      const moved =
        Math.hypot(pose.x - tracked.drawn.x, pose.z - tracked.drawn.z) * Math.sign(pose.speed);
      tracked.drawn = { x: pose.x, z: pose.z };
      model.pose(pose, moved, pose.speed !== 0 || pose.driver !== 0);
    }
  }

  private ensureModel(tracked: Tracked): void {
    if (tracked.model || !this.assets) return;
    tracked.model = this.assets.create(modelFor(tracked.latest.kind, tracked.latest.variant));
    tracked.model.pose(tracked.latest, 0, false);
    this.scene.add(tracked.model.object);
  }
}

/** The car's state at time `t`, blended between the samples either side (or the nearest end). */
function sample(samples: readonly Sample[], t: number): VehicleWire | undefined {
  if (samples.length === 0) return undefined;
  const first = samples[0] as Sample;
  if (t <= first.t) return first.car;
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i] as Sample;
    if (b.t < t) continue;
    const a = samples[i - 1] as Sample;
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    return {
      ...b.car,
      x: a.car.x + (b.car.x - a.car.x) * k,
      z: a.car.z + (b.car.z - a.car.z) * k,
      yaw: lerpAngle(a.car.yaw, b.car.yaw, k),
      steer: a.car.steer + (b.car.steer - a.car.steer) * k,
    };
  }
  return (samples[samples.length - 1] as Sample).car;
}
