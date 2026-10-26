import { describe, expect, it } from 'vitest';
import { trafficSettingsSchema } from '../config/vehicles';
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
} from './traffic';

const S = trafficSettingsSchema.parse({});
const lines = { x: [-30, 30], z: [-20, 20] };

describe('lanes', () => {
  it('keep to the right: southbound is on the west side, northbound on the east', () => {
    expect(laneCentre({ vertical: true, line: 0, dir: 1 }, lines, 3)).toBe(-33); // south, facing +z: west
    expect(laneCentre({ vertical: true, line: 0, dir: -1 }, lines, 3)).toBe(-27);
    expect(laneCentre({ vertical: false, line: 1, dir: 1 }, lines, 3)).toBe(23); // east, facing +x: south
    expect(laneCentre({ vertical: false, line: 1, dir: -1 }, lines, 3)).toBe(17);
  });

  it('turns right and left as seen from above', () => {
    expect(turnRight({ x: 0, z: 1 })).toEqual({ x: -1, z: 0 }); // south → west
    expect(turnRight({ x: 1, z: 0 })).toMatchObject({ z: 1 }); // east → south
    expect(turnLeft({ x: 0, z: 1 })).toMatchObject({ x: 1 }); // south → east
    expect(turnLeft(turnRight({ x: 1, z: 0 })).x).toBeCloseTo(1);
  });

  it('finds the lane going a given way through a junction', () => {
    expect(laneGoing({ x: -1, z: 0 }, 1, 0)).toEqual({ vertical: false, line: 0, dir: -1 });
    expect(laneGoing({ x: 0, z: 1 }, 1, 0)).toEqual({ vertical: true, line: 1, dir: 1 });
    expect(headingOf({ vertical: false, line: 0, dir: -1 })).toEqual({ x: -1, z: 0 });
  });

  it('faces the way of travel: yaw 0 faces north (−z)', () => {
    expect(yawOf({ x: 0, z: -1 })).toBeCloseTo(0);
    expect(Math.abs(yawOf({ x: 0, z: 1 }))).toBeCloseTo(Math.PI); // south: half a turn
    expect(Math.abs(yawOf({ x: 1, z: 0 }))).toBeCloseTo(Math.PI / 2); // east
    expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrap(-3.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
  });
});

describe('signals', () => {
  it('gives each direction a green in turn with all red between, and never both at once', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 2 * (S.greenSeconds + S.clearSeconds); t += 0.25) {
      const s = signalAt(t, 0, 0, S);
      seen.add(s);
      expect(
        mayEnter({ vertical: true, line: 0, dir: 1 }, s) &&
          mayEnter({ vertical: false, line: 0, dir: 1 }, s),
      ).toBe(false);
    }
    expect([...seen].sort()).toEqual(['horizontal', 'none', 'vertical']);
  });

  it('is green for vertical about half the time and repeats', () => {
    const cycle = 2 * (S.greenSeconds + S.clearSeconds);
    let vertical = 0;
    const n = 2000;
    for (let k = 0; k < n; k++) if (signalAt((k / n) * cycle, 2, 3, S) === 'vertical') vertical++;
    expect(vertical / n).toBeCloseTo(S.greenSeconds / cycle, 1);
    expect(signalAt(5, 1, 1, S)).toBe(signalAt(5 + cycle, 1, 1, S));
  });

  it('is out of step between junctions, so a street is not red all at once', () => {
    const states = new Set([0, 1, 2, 3, 4].map((i) => signalAt(3, i, 0, S)));
    expect(states.size).toBeGreaterThan(1);
  });
});

describe('stopping', () => {
  it('lets a car stop in the gap it has, and not a metre more', () => {
    const v = safeSpeed(10, 5);
    expect(v).toBeCloseTo(Math.sqrt(100));
    expect(safeSpeed(0, 5)).toBe(0);
    expect(safeSpeed(-4, 5)).toBe(0);
    // Stopping from v at 5 m/s² takes exactly the gap.
    expect((v * v) / (2 * 5)).toBeCloseTo(10);
  });
});
