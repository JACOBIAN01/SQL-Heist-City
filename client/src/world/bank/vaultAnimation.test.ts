import { describe, expect, it } from 'vitest';
import { VAULT_TIMING, VaultDoorAnimation } from './vaultAnimation';

const T = VAULT_TIMING;

describe('VaultDoorAnimation', () => {
  it('shows a vault as it stands when first heard of, without replaying anything', () => {
    const shut = new VaultDoorAnimation(3);
    expect(shut.observe(0, 10)).toEqual([]);
    expect(shut.pose(10)).toEqual({ wheel: 0, bolts: Array(12).fill(0), swing: 0 });
    const open = new VaultDoorAnimation(3);
    expect(open.observe(3, 10)).toEqual([]);
    expect(open.pose(10).swing).toBe(1);
    expect(open.pose(10).bolts.every((b) => b === 1)).toBe(true);
  });

  it('turns the wheel once and draws that lock’s bolts when a lock is cracked, with sparks', () => {
    const a = new VaultDoorAnimation(3);
    a.observe(0, 0);
    expect(a.observe(1, 5)).toEqual([{ kind: 'sparks', at: 5 }]);
    const mid = a.pose(5 + T.crackSpin / 2);
    expect(mid.wheel).toBeGreaterThan(0);
    expect(mid.wheel).toBeLessThan(Math.PI * 2);
    const after = a.pose(5 + 2);
    expect(after.wheel).toBeCloseTo(Math.PI * 2);
    // Bolts 0, 3, 6, 9 belong to lock 1; the rest stay shot.
    expect(after.bolts.filter((b) => b === 1)).toHaveLength(4);
    expect(after.bolts[0]).toBe(1);
    expect(after.bolts[1]).toBe(0);
    expect(after.swing).toBe(0);
    expect(a.moving(5 + 0.1)).toBe(true);
    expect(a.moving(5 + 2)).toBe(false);
  });

  it('on the last lock spins the wheel twice, draws every bolt, then swings the door open in dust', () => {
    const a = new VaultDoorAnimation(3);
    a.observe(2, 0);
    const effects = a.observe(3, 10);
    expect(effects).toEqual([
      { kind: 'sparks', at: 10 },
      { kind: 'dust', at: 10 + T.swingDelay },
    ]);
    expect(a.pose(10 + T.swingDelay - 0.01).swing).toBe(0); // the bolts go first
    expect(a.pose(10 + T.swingDelay + T.swing / 2).swing).toBeCloseTo(0.5, 1);
    const done = a.pose(10 + T.swingDelay + T.swing + 1);
    expect(done.swing).toBe(1);
    expect(done.bolts.every((b) => b === 1)).toBe(true);
    expect(done.wheel).toBeCloseTo(Math.PI * 2 * T.openTurns);
  });

  it('cracks several locks at once (a late message) one after another in the same instant', () => {
    const a = new VaultDoorAnimation(3);
    a.observe(0, 0);
    expect(a.observe(3, 4).map((e) => e.kind)).toEqual(['sparks', 'sparks', 'sparks', 'dust']);
    expect(a.pose(20).swing).toBe(1);
  });

  it('snaps shut for a new round', () => {
    const a = new VaultDoorAnimation(3);
    a.observe(3, 0);
    expect(a.observe(0, 50)).toEqual([]);
    expect(a.pose(50)).toEqual({ wheel: 0, bolts: Array(12).fill(0), swing: 0 });
  });
});
