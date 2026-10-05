import {
  collideCars,
  createVehicle,
  quantiseVehicleState,
  SIM_DT,
  stepVehicle,
  type DriveControls,
  type GameMap,
  type ParkedCar,
  type VehicleKind,
  type VehicleSettings,
  type VehicleSpec,
  type VehicleState,
  type VehicleWire,
} from '@heist/shared';

/** Other cars further than this (m, centre to centre) cannot touch the one moving. */
const CONTACT_RANGE = 6;
const STILL: DriveControls = { throttle: 0, steer: 0, handbrake: false };

/** One car in the match: where it stands now, who drives it, and where it parks between rounds. */
export class Vehicle {
  state: VehicleState;
  /** Player id at the wheel, 0 when empty. */
  driver = 0;

  constructor(
    readonly id: number,
    readonly kind: VehicleKind,
    readonly variant: number,
    readonly spec: VehicleSpec,
    readonly home: ParkedCar,
  ) {
    this.state = createVehicle(home.x, home.z, home.yaw);
  }

  get moving(): boolean {
    return this.state.speed !== 0;
  }

  /** The car as a client sees it. */
  wire(): VehicleWire {
    const s = this.state;
    return {
      id: this.id,
      kind: this.kind,
      variant: this.variant,
      x: s.x,
      z: s.z,
      yaw: s.yaw,
      steer: s.steer,
      speed: s.speed,
      driver: this.driver,
    };
  }
}

/**
 * Every car in a match. The server owns them: a driver's input steers their
 * car through the same shared physics the client predicts with; empty cars
 * roll to a stop; cars shove each other. States are quantised after each
 * tick to exactly what the wire carries, so a driver's replay starts from
 * the same numbers the server has.
 */
export class VehicleFleet {
  private readonly cars = new Map<number, Vehicle>();

  constructor(
    map: GameMap,
    private readonly settings: VehicleSettings,
  ) {
    (map.parkedCars ?? []).forEach((home, i) => {
      const id = i + 1;
      this.cars.set(id, new Vehicle(id, home.kind, home.variant, settings.kinds[home.kind], home));
    });
  }

  get size(): number {
    return this.cars.size;
  }

  get(id: number): Vehicle | undefined {
    return this.cars.get(id);
  }

  all(): IterableIterator<Vehicle> {
    return this.cars.values();
  }

  get enterRange(): number {
    return this.settings.enterRange;
  }

  get exitMaxSpeed(): number {
    return this.settings.exitMaxSpeed;
  }

  /** One fixed step of a driver's input. */
  drive(car: Vehicle, controls: DriveControls, map: GameMap): void {
    stepVehicle(car.state, controls, SIM_DT, map, car.spec);
    this.shove(car);
  }

  /**
   * Empty cars that are still rolling (a driver jumped out, or another car hit
   * them) coast for one server tick, in the same fixed steps a driver uses.
   */
  coast(map: GameMap, tickSeconds: number): void {
    const steps = Math.max(1, Math.round(tickSeconds / SIM_DT));
    for (const car of this.cars.values()) {
      if (car.driver !== 0 || !car.moving) continue;
      for (let i = 0; i < steps && car.moving; i++) {
        stepVehicle(car.state, STILL, SIM_DT, map, car.spec);
        this.shove(car);
      }
    }
  }

  /** Snaps every car to wire precision: what clients are told is exactly what is simulated. */
  settle(): void {
    for (const car of this.cars.values()) quantiseVehicleState(car.state);
  }

  /** Every car back to its parking spot, empty (a new round). Drivers must be let out first. */
  reset(): void {
    for (const car of this.cars.values()) {
      car.state = createVehicle(car.home.x, car.home.z, car.home.yaw);
      car.driver = 0;
    }
  }

  /** Pushes a moving car out of any car it drove into (the other gets some of the shove). */
  private shove(car: Vehicle): void {
    for (const other of this.cars.values()) {
      if (other === car) continue;
      if (Math.abs(other.state.x - car.state.x) > CONTACT_RANGE) continue;
      if (Math.abs(other.state.z - car.state.z) > CONTACT_RANGE) continue;
      collideCars(car.state, car.spec, other.state, other.spec);
    }
  }
}
