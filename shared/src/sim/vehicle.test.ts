import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_SETTINGS, vehicleSettingsSchema } from '../config/vehicles';
import { box, type GameMap } from '../world/map';
import { mapById } from '../world/maps';
import { Button, SIM_DT } from './input';
import {
  collideCars,
  controlsOf,
  createVehicle,
  distanceToCar,
  exitSpots,
  stepVehicle,
  type DriveControls,
} from './vehicle';

const sedan = DEFAULT_VEHICLE_SETTINGS.kinds.sedan;
const open: GameMap = { id: 'open', halfSize: 500, boxes: [], spawns: [] };
const drive = (c: Partial<DriveControls>): DriveControls => ({
  throttle: 0,
  steer: 0,
  handbrake: false,
  ...c,
});
function run(
  car = createVehicle(0, 0),
  controls: DriveControls,
  seconds: number,
  map: GameMap = open,
) {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++)
    stepVehicle(car, controls, SIM_DT, map, sedan);
  return car;
}

describe('stepVehicle: pedals', () => {
  it('accelerates forward (−z at yaw 0) up to top speed', () => {
    const car = run(undefined, drive({ throttle: 1 }), 1);
    expect(car.speed).toBeCloseTo(sedan.accel, 0);
    expect(car.z).toBeLessThan(-3);
    run(car, drive({ throttle: 1 }), 10);
    expect(car.speed).toBe(sedan.maxSpeed);
  });

  it('coasts to a stop, brakes harder, and the handbrake stops it too', () => {
    const coast = run(run(undefined, drive({ throttle: 1 }), 2), drive({}), 1);
    const brake = run(run(undefined, drive({ throttle: 1 }), 2), drive({ throttle: -1 }), 0.5);
    expect(brake.speed).toBeLessThan(coast.speed);
    expect(run(coast, drive({}), 20).speed).toBe(0);
    expect(run(undefined, drive({ throttle: 1, handbrake: true }), 1).speed).toBe(0);
  });

  it('brakes before reversing, and reverses slower than it drives', () => {
    const car = run(run(undefined, drive({ throttle: 1 }), 2), drive({ throttle: -1 }), 0.3);
    expect(car.speed).toBeGreaterThan(0); // still braking
    run(car, drive({ throttle: -1 }), 6);
    expect(car.speed).toBe(-sedan.reverseSpeed);
  });
});

describe('stepVehicle: steering', () => {
  it('turns right when steering right, and only while moving', () => {
    expect(run(undefined, drive({ steer: 1 }), 1).yaw).toBe(0);
    const car = run(undefined, drive({ throttle: 1, steer: 1 }), 1.5);
    expect(car.yaw).toBeLessThan(-0.2); // clockwise from above
    expect(car.x).toBeGreaterThan(0.5); // heading off to the right (+x)
  });

  it('turns the wheels gradually, with less lock at speed', () => {
    const car = createVehicle(0, 0);
    stepVehicle(car, drive({ steer: -1 }), SIM_DT, open, sedan);
    expect(car.steer).toBeCloseTo(sedan.steerSpeed * SIM_DT);
    run(car, drive({ steer: -1 }), 1);
    expect(car.steer).toBeCloseTo(sedan.maxSteer);
    const fast = run(undefined, drive({ throttle: 1 }), 6);
    run(fast, drive({ throttle: 1, steer: -1 }), 1);
    expect(fast.steer).toBeLessThan(sedan.maxSteer * 0.6);
  });

  it('drives a circle about the size the wheelbase and lock say', () => {
    const car = createVehicle(0, 0);
    let minX = 0;
    let maxX = 0;
    for (let i = 0; i < 60 * 30; i++) {
      stepVehicle(
        car,
        drive({ throttle: car.speed < 5 ? 1 : 0.4, steer: -1 }),
        SIM_DT,
        open,
        sedan,
      );
      minX = Math.min(minX, car.x);
      maxX = Math.max(maxX, car.x);
    }
    const diameter = maxX - minX;
    expect(diameter).toBeGreaterThan(6);
    expect(diameter).toBeLessThan(20);
  });

  it('is deterministic', () => {
    const a = run(undefined, drive({ throttle: 0.8, steer: 0.3 }), 5);
    const b = run(undefined, drive({ throttle: 0.8, steer: 0.3 }), 5);
    expect(a).toEqual(b);
  });
});

describe('stepVehicle: collisions', () => {
  const wall: GameMap = { ...open, boxes: [box('building', 0, -20, 20, 6, 2)] };

  it('stops at a wall and bounces back a little, never passing through', () => {
    const car = run(undefined, drive({ throttle: 1 }), 6, wall);
    // The wall's near face is z = −19; the car's nose (half its length ahead) never crosses it.
    expect(car.z - sedan.length / 2).toBeGreaterThanOrEqual(-19 - 1e-6);
    const hit = run(undefined, drive({ throttle: 1 }), 2.5, wall);
    for (let i = 0; i < 60 && hit.speed >= 0; i++) stepVehicle(hit, drive({}), SIM_DT, wall, sedan);
    expect(hit.speed).toBeLessThanOrEqual(0);
  });

  it('slides along a wall it hits at an angle instead of sticking', () => {
    const side: GameMap = { ...open, boxes: [box('building', 3, 0, 2, 6, 200)] };
    const car = createVehicle(0, 0, -0.4); // heading forward and to the right, into the wall at x = 2
    run(car, drive({ throttle: 1 }), 3, side);
    expect(car.x + sedan.width / 2).toBeLessThan(2.6);
    expect(car.z).toBeLessThan(-10); // kept going along it
  });

  it('drives over kerbs and under nothing it should hit', () => {
    const kerb: GameMap = { ...open, boxes: [box('kerb', 0, -10, 20, 0.15, 3)] };
    const car = run(undefined, drive({ throttle: 1 }), 3, kerb);
    expect(car.z).toBeLessThan(-15);
  });

  it('cannot leave the city through a building at top speed', () => {
    const city = mapById('city');
    if (!city?.city) throw new Error('no city');
    const block = city.city.blocks[12];
    if (!block) throw new Error('no block');
    // From the street west of a downtown block, flat out east into it.
    const car = createVehicle(
      block.outer.minX - 6,
      (block.outer.minZ + block.outer.maxZ) / 2,
      -Math.PI / 2,
    );
    for (let i = 0; i < 60 * 8; i++) stepVehicle(car, drive({ throttle: 1 }), SIM_DT, city, sedan);
    expect(car.x).toBeLessThan(block.outer.maxX);
  });
});

describe('controlsOf', () => {
  it('reads throttle and steering from the movement stick and the handbrake from jump', () => {
    const c = controlsOf({
      seq: 1,
      moveX: 127,
      moveY: -127,
      yaw: 0,
      pitch: 0,
      buttons: Button.Jump,
      viewLagMs: 0,
    });
    expect(c).toEqual({ throttle: -1, steer: 1, handbrake: true });
  });
});

describe('vehicleSettingsSchema', () => {
  it('has a spec per kind, and sports cars are fastest', () => {
    const s = vehicleSettingsSchema.parse({});
    expect(s.kinds.sports.maxSpeed).toBeGreaterThan(s.kinds.sedan.maxSpeed);
    expect(s.kinds.suv.width).toBeGreaterThan(s.kinds.sedan.width);
  });
});

describe('getting in and out', () => {
  it('measures distance to the car body, not its centre', () => {
    const car = createVehicle(0, 0, 0); // facing −z: 4.2 m long on z, 1.8 m wide on x
    expect(distanceToCar(car, sedan, 0, 0)).toBe(0);
    expect(distanceToCar(car, sedan, 1.9, 0)).toBeCloseTo(1.0);
    expect(distanceToCar(car, sedan, 0, -3.1)).toBeCloseTo(1.0);
    // Turned a quarter, the long side is along x.
    expect(distanceToCar(createVehicle(0, 0, Math.PI / 2), sedan, 3.1, 0)).toBeCloseTo(1.0);
  });

  it('offers the driver’s door first, then the other door, behind and in front', () => {
    const [left, right, back, front] = exitSpots(createVehicle(0, 0, 0), sedan);
    expect(left?.x).toBeCloseTo(-(sedan.width / 2 + 0.8)); // facing −z, the left is −x
    expect(right?.x).toBeCloseTo(sedan.width / 2 + 0.8);
    expect(back?.z).toBeGreaterThan(sedan.length / 2);
    expect(front?.z).toBeLessThan(-sedan.length / 2);
  });
});

describe('collideCars', () => {
  it('pushes a car out of another it drove into, and bounces it back', () => {
    const parked = createVehicle(0, -6, 0);
    const car = createVehicle(0, 0, 0);
    let touched = false;
    for (let i = 0; i < 120; i++) {
      stepVehicle(car, drive({ throttle: 1 }), SIM_DT, open, sedan);
      touched = collideCars(car, sedan, parked, sedan) || touched;
    }
    expect(touched).toBe(true);
    // Nose never inside the other car's tail.
    expect(car.z - sedan.length / 2).toBeGreaterThanOrEqual(parked.z + sedan.length / 2 - 1e-6);
    expect(parked.speed).not.toBe(0); // shoved
  });

  it('leaves cars that do not touch alone', () => {
    const a = createVehicle(0, 0, 0);
    const b = createVehicle(3, 0, 0); // side by side with a gap
    expect(collideCars(a, sedan, b, sedan)).toBe(false);
    expect(a.x).toBe(0);
  });
});
