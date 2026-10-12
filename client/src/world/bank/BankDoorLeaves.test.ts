import { describe, expect, it } from 'vitest';
import { BANK_1, BANK_2, BANK_5 } from '@heist/shared';
import { doorLeaves } from './BankDoorLeaves';

const site = { tier: 1, x: 10, z: -8 };

describe('doorLeaves', () => {
  it('hangs two leaves in every interior doorway, and none in the vault doorway', () => {
    // Bank 1: the staff door on storey 0 (the vault's doorway on storey 2 has its own door).
    const leaves = doorLeaves(BANK_1, site);
    expect(leaves).toHaveLength(2);
    expect(leaves.every((l) => l.y === 0)).toBe(true);
  });

  it('puts the leaves on the two jambs of the opening, 2 m apart for a 2 m door', () => {
    const [a, b] = doorLeaves(BANK_1, site);
    if (!a || !b) throw new Error('no leaves');
    // The opening is in the wall x = 4 (local), from z = −9 + 2.5 to −9 + 4.5.
    expect(a.x).toBeCloseTo(site.x + 4);
    expect(b.x).toBeCloseTo(site.x + 4);
    expect(Math.abs(b.z - a.z)).toBeCloseTo(2);
    expect(a.sx).toBeGreaterThan(1);
  });

  it('stands both leaves on the same side of the wall, open', () => {
    const [a, b] = doorLeaves(BANK_1, site);
    if (!a || !b) throw new Error('no leaves');
    // Leaf direction = (−cos yaw, sin yaw); both lean into the same half-plane (same x sign).
    expect(Math.sign(-Math.cos(a.yaw))).toBe(Math.sign(-Math.cos(b.yaw)));
    expect(Math.abs(Math.cos(a.yaw))).toBeLessThan(0.99);
  });

  it('counts every doorway of the bigger banks, skipping windows', () => {
    expect(doorLeaves(BANK_2, site).length).toBeGreaterThanOrEqual(8);
    expect(doorLeaves(BANK_5, site).length).toBeGreaterThanOrEqual(6);
    for (const l of doorLeaves(BANK_5, site)) expect(l.sy).toBeGreaterThan(0.9);
  });
});
