import { describe, expect, it } from 'vitest';
import { box, DEFAULT_AUDIO_SETTINGS, strideAt, type GameMap } from '@heist/shared';
import { FootstepTracker, surfaceAt } from './Footsteps';

const s = DEFAULT_AUDIO_SETTINGS;
const DT = 1 / 60;

/** Steps taken walking in a straight line at `speed` for `seconds`. */
function walk(speed: number, seconds: number, onGround = () => true): number {
  const t = new FootstepTracker(s);
  let steps = 0;
  for (let i = 0; i <= seconds / DT; i++) if (t.update(i * DT * speed, 0, onGround(), DT)) steps++;
  return steps;
}

describe('FootstepTracker', () => {
  it('takes one step per stride, and longer strides at a sprint', () => {
    expect(walk(4.2, 10)).toBeCloseTo(42 / strideAt(4.2, s), -1);
    const jog = walk(4.2, 10);
    const sprint = walk(6.8, 10);
    expect(sprint).toBeGreaterThan(jog); // more steps a second…
    expect(68 / sprint).toBeGreaterThan(42 / jog); // …but each covers more ground
  });

  it('is silent standing still or in the air, and lands with a step', () => {
    expect(walk(0, 5)).toBe(0);
    const t = new FootstepTracker(s);
    t.update(0, 0, true, DT);
    expect(t.update(0.05, 0, false, DT)).toBe(false);
    expect(t.update(0.1, 0, false, DT)).toBe(false);
    expect(t.update(0.15, 0, true, DT)).toBe(true); // landed
  });

  it('does not step for a teleport (respawn, lift)', () => {
    const t = new FootstepTracker(s);
    t.update(0, 0, true, DT);
    expect(t.update(50, 0, true, DT)).toBe(false);
  });
});

describe('surfaceAt', () => {
  const map: GameMap = {
    id: 'm',
    halfSize: 50,
    spawns: [],
    boxes: [
      box('interior', 0, 0, 10, 0.2, 10, 3.8), // a bank floor, top at 4
      box('crate', 20, 0, 2, 1, 2),
      box('kerb', -20, 0, 4, 0.15, 4),
    ],
  };

  it('tells the street, a bank floor, a crate and a kerb apart', () => {
    expect(surfaceAt(map, 30, 0, 30)).toBe('concrete');
    expect(surfaceAt(map, 0, 4, 0)).toBe('tile');
    expect(surfaceAt(map, 20, 1, 0)).toBe('metal');
    expect(surfaceAt(map, -20, 0.15, 0)).toBe('concrete');
  });
});
