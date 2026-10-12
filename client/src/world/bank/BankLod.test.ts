import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { BANK_1, type BankLayout } from '@heist/shared';
import { BankLod } from './BankLod';

const site = { tier: 1, x: 100, z: 50 };
const layouts = new Map<number, BankLayout>([[1, BANK_1]]);

function scene() {
  const root = new Group();
  const groups = [0, 1, 2].map((storey) => {
    const g = new Group();
    g.userData = { bankTier: 1, storey };
    root.add(g);
    return g;
  });
  const other = new Group();
  other.userData = { bankTier: 9, storey: 0 }; // a bank the LOD does not know
  root.add(other);
  const lod = new BankLod([site], layouts);
  lod.add(root);
  return { lod, groups, other };
}
const shown = (groups: Group[]) => groups.map((g) => g.visible);

describe('BankLod', () => {
  it('registers tagged groups once, and ignores banks it does not know', () => {
    const { lod } = scene();
    expect(lod.size).toBe(3);
    const again = new Group();
    again.userData = { bankTier: 1, storey: 1 };
    lod.add(again);
    lod.add(again);
    expect(lod.size).toBe(4);
  });

  it('draws nothing beyond the range', () => {
    const { lod, groups } = scene();
    lod.update(100, 0, 50 + BANK_1.depth / 2 + 41);
    expect(shown(groups)).toEqual([false, false, false]);
  });

  it('draws only the ground floor from the street, near the bank', () => {
    const { lod, groups } = scene();
    lod.update(100, 0, 50 + BANK_1.depth / 2 + 10);
    expect(shown(groups)).toEqual([true, false, false]);
  });

  it("draws the player's storey and its neighbours inside", () => {
    const { lod, groups } = scene();
    lod.update(100, 0, 50);
    expect(shown(groups)).toEqual([true, true, false]);
    lod.update(100, BANK_1.storeyHeight, 50);
    expect(shown(groups)).toEqual([true, true, true]);
    lod.update(100, 2 * BANK_1.storeyHeight, 50);
    expect(shown(groups)).toEqual([false, true, true]);
  });

  it('brings a group back when the player returns', () => {
    const { lod, groups } = scene();
    lod.update(0, 0, 0);
    expect(shown(groups)).toEqual([false, false, false]);
    lod.update(100, 0, 50);
    expect(groups[0]?.visible).toBe(true);
  });
});
