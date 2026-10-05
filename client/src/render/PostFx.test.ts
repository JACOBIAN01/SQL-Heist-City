import { describe, expect, it } from 'vitest';
import { bloomStrength, FrameBudget } from './PostFx';

describe('bloomStrength', () => {
  it('blooms gently by day and more at night, when windows glow', () => {
    expect(bloomStrength(0)).toBeLessThan(0.3);
    expect(bloomStrength(1)).toBeGreaterThan(0.6);
    expect(bloomStrength(0.5)).toBeCloseTo((bloomStrength(0) + bloomStrength(1)) / 2);
    expect(bloomStrength(5)).toBe(bloomStrength(1));
  });
});

describe('FrameBudget', () => {
  it('stays quiet at 60 fps and through single spikes', () => {
    const budget = new FrameBudget(18, 3000);
    for (let i = 0; i < 600; i++) expect(budget.push(i % 100 === 0 ? 80 : 16.6)).toBe(false);
  });

  it('asks to step down after a slow stretch, then waits for a new one', () => {
    const budget = new FrameBudget(18, 3000);
    const results: boolean[] = [];
    for (let i = 0; i < 300; i++) results.push(budget.push(25)); // 40 fps for 7.5 s
    expect(results.filter(Boolean)).toHaveLength(2); // once per 3 s window
  });
});
