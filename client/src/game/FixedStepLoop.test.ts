import { describe, expect, it, vi } from 'vitest';
import { FixedStepLoop } from './FixedStepLoop';

describe('FixedStepLoop', () => {
  it('runs whole ticks and carries the remainder', () => {
    const tick = vi.fn();
    const loop = new FixedStepLoop(0.01, tick);
    expect(loop.advance(0.025)).toBe(2);
    expect(loop.alpha).toBeCloseTo(0.5);
    expect(loop.advance(0.005)).toBe(1);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('runs nothing for a frame shorter than a tick', () => {
    const tick = vi.fn();
    expect(new FixedStepLoop(0.01, tick).advance(0.004)).toBe(0);
    expect(tick).not.toHaveBeenCalled();
  });

  it('caps catch-up after a stall instead of freezing the page', () => {
    const tick = vi.fn();
    const loop = new FixedStepLoop(0.01, tick, 5);
    expect(loop.advance(10)).toBe(5);
    expect(loop.alpha).toBe(0);
  });
});
