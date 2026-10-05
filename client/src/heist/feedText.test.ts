import { describe, expect, it } from 'vitest';
import { feedText } from './feedText';

describe('feedText', () => {
  it('raises the alarm with the bank and how far the crack has got', () => {
    expect(
      feedText({ kind: 'alarm', bank: 'Metro Capital', tier: 3, lock: 2, locks: 3 }, 1),
    ).toEqual({ text: 'ALARM · Metro Capital (bank 3): lock 2/3 cracked', tone: 'alarm' });
    expect(feedText({ kind: 'vault_open', bank: 'Metro Capital', tier: 3 }, 1).tone).toBe('vault');
  });

  it('says "you" by id, not by name (names repeat)', () => {
    const banked = { kind: 'banked', id: 7, name: 'Player', amount: 30_000 } as const;
    expect(feedText(banked, 7).text).toBe('You banked $30,000');
    expect(feedText(banked, 8).text).toBe('Player banked $30,000');
    const wanted = { kind: 'wanted', id: 7, name: 'Ana', cash: 120_000, reward: 10_000 } as const;
    expect(feedText(wanted, 7).text).toMatch(/^You are WANTED/);
    expect(feedText(wanted, 8).text).toBe('Ana carries $120,000 · $10,000 bounty');
    const claimed = {
      kind: 'bounty_claimed',
      killerId: 8,
      killer: 'Ben',
      victimId: 7,
      victim: 'Ana',
      reward: 10_000,
    } as const;
    expect(feedText(claimed, 7).text).toBe('Ben claimed the $10,000 bounty on you');
    expect(feedText(claimed, 8).text).toBe('You claimed the $10,000 bounty on Ana');
  });
});
