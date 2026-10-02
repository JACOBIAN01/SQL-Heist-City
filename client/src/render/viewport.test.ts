import { describe, expect, it } from 'vitest';
import { MAX_PIXEL_RATIO, computeViewport } from './viewport';

describe('computeViewport', () => {
  it('caps high-DPI screens to protect the frame budget', () => {
    expect(computeViewport(1280, 720, 3).pixelRatio).toBe(MAX_PIXEL_RATIO);
  });

  it('never returns a zero size (minimised window)', () => {
    const v = computeViewport(0, 0, 1);
    expect(v.width).toBe(1);
    expect(v.height).toBe(1);
    expect(v.aspect).toBe(1);
  });

  it('computes aspect from whole pixels', () => {
    expect(computeViewport(1920.7, 1080.2, 1).aspect).toBeCloseTo(1920 / 1080);
  });
});
