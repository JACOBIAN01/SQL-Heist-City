import { describe, expect, it } from 'vitest';
import { DEFAULT_ATMOSPHERE_SETTINGS, DEFAULT_VEHICLE_SETTINGS } from '@heist/shared';
import { LiveWorld } from './liveWorld';

describe('LiveWorld', () => {
  it('starts as the defaults without sharing their objects', () => {
    const world = new LiveWorld();
    expect(world.vehicles).toEqual(DEFAULT_VEHICLE_SETTINGS);
    world.vehicles.kinds.sedan.maxSpeed = 99;
    expect(DEFAULT_VEHICLE_SETTINGS.kinds.sedan.maxSpeed).not.toBe(99);
  });

  it('follows the server in place, so holders of the old objects see new numbers', () => {
    const world = new LiveWorld();
    const sedan = world.vehicles.kinds.sedan; // held by code built earlier
    const atmosphere = world.atmosphere;
    world.apply({
      vehicles: {
        ...DEFAULT_VEHICLE_SETTINGS,
        enterRange: 3,
        kinds: {
          ...DEFAULT_VEHICLE_SETTINGS.kinds,
          sedan: { ...DEFAULT_VEHICLE_SETTINGS.kinds.sedan, maxSpeed: 33 },
        },
      },
      atmosphere: { ...DEFAULT_ATMOSPHERE_SETTINGS, dayMinutes: 7 },
    });
    expect(sedan.maxSpeed).toBe(33);
    expect(world.vehicles.enterRange).toBe(3);
    expect(atmosphere.dayMinutes).toBe(7);
  });
});
