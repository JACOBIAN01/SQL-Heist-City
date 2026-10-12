import { describe, expect, it } from 'vitest';
import type { Box3, Mesh } from 'three';
import { BANK_1, BANK_LAYOUTS, HEIST_MAP, validateBank, type BankLayout } from '@heist/shared';
import { buildBankFixtures } from './BankFixturesArt';
import { createBankMaterials } from './bankMaterials';

const materials = createBankMaterials();
const root = buildBankFixtures(HEIST_MAP, materials);
const storey0 = () =>
  root.getObjectByName('bank-fixtures-bank-1')?.children.find((c) => c.userData.storey === 0);
const meshOf = (material: string) =>
  storey0()?.children.find((c) => (c as Mesh).material === materialByName(material)) as
    Mesh | undefined;
const materialByName = (name: string) => {
  let found: unknown;
  storey0()?.traverse((o) => {
    const m = (o as { material?: { name?: string } }).material;
    if (m?.name === name) found = m;
  });
  return found;
};
const tris = (m?: Mesh) => (m?.geometry.index?.count ?? 0) / 3;
const bounds = (m?: Mesh) => {
  m?.geometry.computeBoundingBox();
  return m?.geometry.boundingBox as Box3;
};

describe('bank fixtures', () => {
  it('merges a storey into a mesh per material, tagged with its bank and storey', () => {
    const group = storey0();
    expect(group?.userData).toMatchObject({ bankTier: 1, storey: 0 });
    // Brass, glass and rope: three draw calls for every post, pane and rope on the floor.
    expect(group?.children).toHaveLength(3);
    expect(root.getObjectByName('bank-fixtures-bank-1')?.children).toHaveLength(1);
  });

  it('stands glass teller panes from just above the counter up to 2 m', () => {
    const glass = meshOf('bank-glass');
    // 6 m at one pane per 1.5 m: four panes, plus one on the 2 m screen; 12 triangles each.
    expect(tris(glass)).toBe(5 * 12);
    const b = bounds(glass);
    expect(b.min.x).toBeCloseTo(-8.5, 0);
    expect(b.max.y).toBeCloseTo(2.0, 1);
    expect(b.min.y).toBeCloseTo(1.45, 1);
    expect(glass?.renderOrder).toBe(5);
  });

  it('runs queue posts along x and along z as the layout says, with a rope between each pair', () => {
    const rope = meshOf('bank-rope');
    const b = bounds(rope);
    // The 7.2 m run along x, from x = −6.6 to 0.6, and the 3 m run along z at x = −6.6.
    expect(b.max.x - b.min.x).toBeGreaterThan(7);
    expect(b.max.z - b.min.z).toBeGreaterThan(2.8);
    // Six gaps on the long run and three on the short one, two rope pieces (24 triangles) each.
    expect(tris(rope)).toBe((6 + 3) * 2 * 24);
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
