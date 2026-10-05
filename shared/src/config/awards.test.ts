import { describe, expect, it } from 'vitest';
import { AWARD_IDS, AWARDS } from './awards';

describe('round awards', () => {
  it('has words and a unit for every award', () => {
    expect(Object.keys(AWARDS).sort()).toEqual([...AWARD_IDS].sort());
    for (const id of AWARD_IDS) expect(AWARDS[id].title.length).toBeGreaterThan(0);
  });
});
