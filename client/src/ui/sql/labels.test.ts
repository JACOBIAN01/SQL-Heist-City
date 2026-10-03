import { describe, expect, it } from 'vitest';
import { hintCostText, rewardLabel } from './labels';

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
