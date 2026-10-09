import { describe, expect, it } from 'vitest';
import { Box3, type Object3D } from 'three';
import { BANK_1, BANK_LAYOUTS, HEIST_MAP, validateBank, type BankLayout } from '@heist/shared';
import { buildBankFixtures } from './BankFixturesArt';
import { createBankMaterials } from './bankMaterials';

const materials = createBankMaterials();
const root = buildBankFixtures(HEIST_MAP, materials);
const kinds = (name: string) =>
  root.getObjectByName(`bank-fixtures-bank-1`)?.children.filter((c) => c.name === name) ?? [];
const box = (o: Object3D) => new Box3().setFromObject(o);

describe('bank fixtures', () => {
  it('stands a glass teller screen over each counter, from just above it up to 2 m', () => {
    const screens = kinds('tellerScreen');
    expect(screens).toHaveLength(2);
    const long = box(screens[0] as Object3D);
    expect(long.min.x).toBeCloseTo(-8.5 - 0.03, 1);
    expect(long.max.x).toBeCloseTo(-2.5 + 0.03, 1);
    expect(long.max.y).toBeCloseTo(2.05, 1);
    expect(long.min.y).toBeCloseTo(1.1, 1);
    let glass = 0;
    screens[0]?.traverse((o) => {
      const m = (o as unknown as { material?: { name?: string } }).material;
      if (m?.name === 'bank-glass') glass++;
    });
    expect(glass).toBe(4); // 6 m: posts every 1.5 m → four panes
  });

  it('runs queue posts along x or z as the layout says, with a rope between each pair', () => {
    const [alongX, alongZ] = kinds('queuePosts') as [Object3D, Object3D];
    const x = box(alongX);
    expect(x.max.x - x.min.x).toBeGreaterThan(7);
    expect(x.max.z - x.min.z).toBeLessThan(0.5);
    const z = box(alongZ);
    expect(z.max.z - z.min.z).toBeGreaterThan(2.8);
    expect(z.max.x - z.min.x).toBeLessThan(0.5);
    // 7.2 m at 1.2 m → 7 posts, 6 gaps, two rope pieces each; per post a base, pole and cap.
    expect(alongX.children).toHaveLength(7 * 3 + 6 * 2);
  });

  it('puts each fixture where the layout says, on its storey', () => {
    const [first] = kinds('tellerScreen');
    expect(first?.position.toArray()).toEqual([-5.5, 0, -2]);
  });

  it('is empty for a map without banks', () => {
    expect(buildBankFixtures({ ...HEIST_MAP, banks: [] }, materials).children).toHaveLength(0);
  });
});

describe('fixtures in layouts', () => {
  it('are validated: a missing storey or a run outside the walls is refused', () => {
    const base = (f: NonNullable<BankLayout['fixtures']>): BankLayout => ({
      ...BANK_1,
      fixtures: f,
    });
    expect(() =>
      validateBank(base([{ kind: 'queuePosts', storey: 5, x: 0, z: 0, width: 2, facing: '+z' }])),
    ).toThrow(/missing storey/);
    expect(() =>
      validateBank(
        base([{ kind: 'tellerScreen', storey: 0, x: 11, z: 0, width: 6, facing: '+z' }]),
      ),
    ).toThrow(/leaves the footprint/);
    expect(BANK_LAYOUTS.get(1)).toBe(BANK_1);
  });
});
