import { describe, expect, it } from 'vitest';
import { formatClock, hintCostText, rewardLabel } from './labels';

describe('rewardLabel', () => {
  it('names known rewards, vault locks, and falls back to the key', () => {
    expect(rewardLabel('gun:rifle')).toBe('Rifle');
    expect(rewardLabel('vault:bank-3:lock-2')).toBe('Vault lock 2 (bank 3)');
    expect(rewardLabel('mystery:thing')).toBe('mystery:thing');
  });
});

describe('hintCostText', () => {
  it("shows the server's cost in its own units", () => {
    expect(hintCostText(0.05, 'fraction')).toBe('−5% of your cash');
    expect(hintCostText(250, 'absolute')).toBe('−$250');
    expect(hintCostText(0, 'fraction')).toBe('free');
  });
});

describe('formatClock', () => {
  it('formats remaining time as m:ss, rounding up and never going negative', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(61_001)).toBe('1:02');
    expect(formatClock(9_000)).toBe('0:09');
    expect(formatClock(-5)).toBe('0:00');
  });
});
