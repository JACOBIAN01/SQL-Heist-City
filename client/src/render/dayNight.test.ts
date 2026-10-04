import { describe, expect, it } from 'vitest';
import { skyAt } from './dayNight';

describe('skyAt', () => {
  it('puts the sun high at noon and below the horizon at midnight', () => {
    expect(skyAt(12).sunDirection.y).toBeGreaterThan(0.9);
    expect(skyAt(0).sunDirection.y).toBeLessThan(-0.9);
    expect(skyAt(6).sunDirection.x).toBeGreaterThan(0.9); // rises in the east
    expect(skyAt(18).sunDirection.x).toBeLessThan(-0.9); // sets in the west
  });

  it('always lights from above, the moon taking over at night', () => {
    for (let h = 0; h < 24; h += 0.5) expect(skyAt(h).lightDirection.y).toBeGreaterThan(0.2);
    expect(skyAt(0).lightIntensity).toBeLessThan(skyAt(12).lightIntensity / 3);
  });

  it('is night (glowing windows, closer fog) at midnight and day at noon', () => {
    expect(skyAt(0).night).toBe(1);
    expect(skyAt(12).night).toBe(0);
    expect(skyAt(0).fogFar).toBeLessThan(skyAt(12).fogFar);
  });

  it('keeps nights playable: some ambient light is always left', () => {
    for (let h = 0; h < 24; h += 0.5) expect(skyAt(h).ambientIntensity).toBeGreaterThanOrEqual(0.5);
  });

  it('changes smoothly and wraps around midnight', () => {
    for (let h = 0; h < 24; h += 0.1) {
      const a = skyAt(h);
      const b = skyAt(h + 0.1);
      expect(Math.abs(a.lightIntensity - b.lightIntensity)).toBeLessThan(0.2);
      expect(Math.abs(a.horizon.r - b.horizon.r)).toBeLessThan(0.1);
    }
    expect(skyAt(24)).toEqual(skyAt(0));
    expect(skyAt(-1).hour).toBeCloseTo(23);
  });

  it('warms the horizon at dawn and dusk', () => {
    const dusk = skyAt(18.5).horizon;
    expect(dusk.r).toBeGreaterThan(dusk.b);
    const noon = skyAt(13).horizon;
    expect(noon.b).toBeGreaterThan(noon.r);
  });
});
