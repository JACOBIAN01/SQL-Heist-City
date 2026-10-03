import { describe, expect, it } from 'vitest';
import { rewardLabel } from './labels';

describe('rewardLabel', () => {
  it('names known rewards, vault locks, and falls back to the key', () => {
    expect(rewardLabel('gun:rifle')).toBe('Rifle');
    expect(rewardLabel('vault:bank-3:lock-2')).toBe('Vault lock 2 (bank 3)');
    expect(rewardLabel('mystery:thing')).toBe('mystery:thing');
  });
});
