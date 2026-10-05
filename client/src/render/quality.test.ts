import { describe, expect, it } from 'vitest';
import { QualityLadder } from './quality';

const walk = (ladder: QualityLadder) => {
  const steps = [`${ladder.current.fx}@${ladder.pixelRatio}`];
  while (ladder.stepDown()) steps.push(`${ladder.current.fx}@${ladder.pixelRatio}`);
  return steps;
};

describe('QualityLadder', () => {
  it('drops effects first, then resolution, on a high-DPI screen', () => {
    expect(walk(new QualityLadder(2))).toEqual([
      'high@2',
      'fxaa@2',
      'fxaa@1.5',
      'off@1.5',
      'off@1',
    ]);
  });

  it('skips steps that would change nothing on a 1× screen', () => {
    expect(walk(new QualityLadder(1))).toEqual(['high@1', 'fxaa@1', 'off@1']);
  });

  it('never renders above the screen’s own pixel ratio, nor below 1', () => {
    expect(new QualityLadder(1.25).pixelRatio).toBe(1.25);
    expect(new QualityLadder(3).pixelRatio).toBe(2);
    expect(new QualityLadder(0.5).pixelRatio).toBe(1);
  });
});
