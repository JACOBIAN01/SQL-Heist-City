import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_SETTINGS, mapById, type GameMap } from '@heist/shared';
import { VehicleFleet } from './VehicleFleet';

const open: GameMap = {
  id: 'open',
  halfSize: 200,
  boxes: [],
  spawns: [],
  parkedCars: [
    { x: 0, z: 0, yaw: 0, kind: 'sedan', variant: 1 },
    { x: 0, z: -12, yaw: 0, kind: 'suv', variant: 0 },
  ],
};
const full = { throttle: 1, steer: 0, handbrake: false };

describe('VehicleFleet', () => {
  it('parks one car per parking spot of the map, with its kind’s spec', () => {
    const fleet = new VehicleFleet(open, DEFAULT_VEHICLE_SETTINGS);
    expect(fleet.size).toBe(2);
    const suv = fleet.get(2);
    expect(suv?.spec).toBe(DEFAULT_VEHICLE_SETTINGS.kinds.suv);
    expect(suv?.wire()).toMatchObject({ id: 2, kind: 'suv', x: 0, z: -12, driver: 0 });
    expect(new VehicleFleet(mapById('city') as GameMap, DEFAULT_VEHICLE_SETTINGS).size).toBe(
      mapById('city')?.parkedCars?.length,
    );
  });

  it('drives a car with input and shoves the one it runs into', () => {
    const fleet = new VehicleFleet(open, DEFAULT_VEHICLE_SETTINGS);
    const car = fleet.get(1);
    const parked = fleet.get(2);
    if (!car || !parked) throw new Error('no cars');
    for (let i = 0; i < 120; i++) fleet.drive(car, full, open);
    // Never inside the SUV ahead.
    expect(car.state.z - car.spec.length / 2).toBeGreaterThanOrEqual(
      parked.state.z + parked.spec.length / 2 - 1e-6,
    );
    expect(parked.moving).toBe(true);
  });

  it('lets an empty car roll to a stop, but leaves a driven one to its driver', () => {
    const fleet = new VehicleFleet(open, DEFAULT_VEHICLE_SETTINGS);
    const car = fleet.get(1);
    if (!car) throw new Error('no car');
    car.state.speed = 5;
    car.driver = 3;
    fleet.coast(open, 0.05);
    expect(car.state.z).toBe(0);
    car.driver = 0;
    fleet.coast(open, 0.05);
    expect(car.state.z).toBeLessThan(0);
    for (let i = 0; i < 100; i++) fleet.coast(open, 0.05);
    expect(car.moving).toBe(false);
  });

  it('settles states to wire precision and parks everything again for a new round', () => {
    const fleet = new VehicleFleet(open, DEFAULT_VEHICLE_SETTINGS);
    const car = fleet.get(1);
    if (!car) throw new Error('no car');
    car.state.x = 1.23456;
    fleet.settle();
    expect(car.state.x).toBeCloseTo(1.24, 6); // 2 cm steps
    car.driver = 9;
    fleet.reset();
    expect(car.driver).toBe(0);
    expect(car.state).toEqual({ x: 0, z: 0, yaw: 0, speed: 0, steer: 0 });
  });
});
