import { describe, expect, it } from 'vitest';
import { selectAnimation, thresholdsFor } from './animation';

const t = thresholdsFor(4, 7);

describe('selectAnimation', () => {
  it.each([
    [{ speed: 0, crouching: false, onGround: true }, 'idle'],
    [{ speed: 4, crouching: false, onGround: true }, 'walk'],
    [{ speed: 6.5, crouching: false, onGround: true }, 'run'],
    [{ speed: 0, crouching: true, onGround: true }, 'crouch'],
    [{ speed: 2, crouching: true, onGround: true }, 'crouchWalk'],
    [{ speed: 6, crouching: false, onGround: false }, 'air'],
  ] as const)('%j → %s', (motion, expected) => {
    expect(selectAnimation(motion, t)).toBe(expected);
  });
});
