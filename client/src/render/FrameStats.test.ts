import { describe, expect, it } from 'vitest';
import { FrameStats } from './FrameStats';

describe('FrameStats', () => {
  it('reports zero before any frame', () => {
    const stats = new FrameStats();
    expect(stats.fps).toBe(0);
    expect(stats.worstMs).toBe(0);
  });

  it('averages the window and tracks the worst frame', () => {
    const stats = new FrameStats();
    for (const ms of [16, 16, 16, 40]) stats.push(ms);
    expect(stats.fps).toBeCloseTo(1000 / 22, 5);
    expect(stats.worstMs).toBe(40);
  });

  it('forgets frames older than the window', () => {
    const stats = new FrameStats(2);
    stats.push(100);
    stats.push(10);
    stats.push(10);
    expect(stats.worstMs).toBe(10);
    expect(stats.fps).toBeCloseTo(100, 5);
  });
});
