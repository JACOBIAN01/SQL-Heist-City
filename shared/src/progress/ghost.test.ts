import { describe, expect, it } from 'vitest';
import { ghostAt } from './ghost';

const trace = { step: 1, points: [0, 0, 0, 10, 0, 0, 10, 0, 20] };

describe('ghostAt (34.6)', () => {
  it('moves between samples in a straight line', () => {
    expect(ghostAt(trace, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(ghostAt(trace, 0.5)).toEqual({ x: 5, y: 0, z: 0 });
    expect(ghostAt(trace, 1.5)).toEqual({ x: 10, y: 0, z: 10 });
  });

  it('stops at its last sample, and does not go back before the start', () => {
    expect(ghostAt(trace, 99)).toEqual({ x: 10, y: 0, z: 20 });
    expect(ghostAt(trace, -5)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('has nowhere to be with no samples', () => {
    expect(ghostAt({ step: 1, points: [] }, 3)).toBeUndefined();
  });

  it('honours a slower sampling step', () => {
    expect(ghostAt({ step: 2, points: [0, 0, 0, 10, 0, 0] }, 1)).toEqual({ x: 5, y: 0, z: 0 });
  });
});
