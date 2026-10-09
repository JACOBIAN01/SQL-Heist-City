import { describe, expect, it } from 'vitest';
import type { BufferGeometry, Mesh } from 'three';
import { BANK_1, HEIST_MAP, box, compileBank, type GameMap } from '@heist/shared';
import { buildMapObject } from '../MapRenderer';
import { BankShellBuilder, insideDressedBank, subtractRect } from './BankShellArt';
import { createBankMaterials } from './bankMaterials';

const materials = createBankMaterials();
const site = { tier: 1, x: 10, z: -4 };
const shell = new BankShellBuilder(BANK_1, site).build(materials);
const mesh = (surface: string) => shell.getObjectByName(`bank-${surface}`) as Mesh | undefined;

/** Area of the up-facing triangles of a geometry at height y. */
function floorArea(g: BufferGeometry | undefined, y: number): number {
  if (!g) return 0;
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  let area = 0;
  for (let i = 0; i < p.count; i += 3) {
    if (n.getY(i) < 0.99 || Math.abs(p.getY(i) - y) > 1e-3) continue;
    const ax = p.getX(i + 1) - p.getX(i);
    const az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i);
    const bz = p.getZ(i + 2) - p.getZ(i);
    area += Math.abs(ax * bz - az * bx) / 2;
  }
  return area;
}

/** Every vertex of a surface lies in this box (world coordinates). */
function within(
  g: BufferGeometry | undefined,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  const p = g?.getAttribute('position');
  if (!p) return false;
  for (let i = 0; i < p.count; i++)
    if (
      p.getX(i) < b.minX - 1e-6 ||
      p.getX(i) > b.maxX + 1e-6 ||
      p.getZ(i) < b.minZ - 1e-6 ||
      p.getZ(i) > b.maxZ + 1e-6
    )
      return false;
  return true;
}

describe('subtractRect', () => {
  it('leaves what a cut does not cover, in up to four pieces', () => {
    const r = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    expect(subtractRect(r, { minX: 20, maxX: 30, minZ: 0, maxZ: 1 })).toEqual([r]);
    const left = subtractRect(r, { minX: 4, maxX: 6, minZ: 4, maxZ: 6 });
    expect(left).toHaveLength(4);
    const area = left.reduce((a, p) => a + (p.maxX - p.minX) * (p.maxZ - p.minZ), 0);
    expect(area).toBe(96);
    expect(subtractRect(r, { minX: -1, maxX: 11, minZ: -1, maxZ: 11 })).toEqual([]);
  });
});

describe('BankShellBuilder (Bank 1)', () => {
  const area = (s: string, y: number) => floorArea(mesh(s)?.geometry, y);

  it('floors the ground storey once, wall to wall, with each room in its finish', () => {
    const ground = ['marble', 'wood', 'tile', 'carpet', 'steel'].reduce(
      (a, s) => a + area(s, 0.01),
      0,
    );
    expect(ground).toBeCloseTo(BANK_1.width * BANK_1.depth, 3);
    // The back office is tiled; behind the counter is wood; the lobby is marble.
    expect(area('tile', 0.01)).toBeCloseTo(64, 3);
    expect(area('wood', 0.01)).toBeGreaterThan(0);
    expect(area('marble', 0.01)).toBeGreaterThan(100);
  });

  it('lays the vault in steel, floor and walls, and carpets the offices', () => {
    expect(area('steel', 6)).toBeCloseTo(64, 3);
    expect(
      within(mesh('steel')?.geometry, {
        minX: site.x + 4,
        maxX: site.x + 12,
        minZ: site.z - 9,
        maxZ: site.z - 1,
      }),
    ).toBe(true);
    expect(mesh('steelWall')).toBeDefined();
    expect(area('carpet', 3)).toBeGreaterThan(300); // storey 1, minus the stairwell
  });

  it('dresses the outside in stone with a roof, and the inside with wainscoted walls and ceilings', () => {
    for (const s of ['stone', 'roof', 'plaster', 'panel', 'ceiling', 'counter', 'trim'])
      expect(mesh(s), s).toBeDefined();
  });

  it('lets only the outside take sun and cast shadows', () => {
    expect(mesh('stone')?.castShadow).toBe(true);
    expect(mesh('plaster')?.receiveShadow).toBe(false);
  });
});

describe('BankShellBuilder cladding and marble walls', () => {
  const dressed = new BankShellBuilder(
    {
      ...BANK_1,
      cladding: 'granite',
      rooms: [{ storey: 0, x: 0, z: 0, width: 24, depth: 18, walls: 'marble' }],
    },
    site,
  ).build(materials);
  const part = (surface: string) => dressed.getObjectByName(`bank-${surface}`) as Mesh | undefined;

  it("clads the outside in the layout's stone and lets that take the sun", () => {
    expect(part('granite')?.castShadow).toBe(true);
    expect(part('stone')).toBeUndefined();
  });

  it('lines a room with marble when asked', () => {
    expect(part('marbleWall')).toBeDefined();
    expect(part('marbleWall')?.receiveShadow).toBe(false);
  });
});

describe('insideDressedBank', () => {
  const map = { banks: [{ tier: 1, x: 0, z: 0 }] } as unknown as GameMap;
  const skip = insideDressedBank(map);

  it('picks out the boxes a dressed bank draws itself, and nothing else', () => {
    const bankBoxes = compileBank(BANK_1, { x: 0, z: 0 });
    expect(bankBoxes.filter((b) => b.kind !== 'furniture').every(skip)).toBe(true);
    expect(bankBoxes.filter((b) => b.kind === 'furniture').some(skip)).toBe(false);
    expect(skip(box('building', 30, 30, 6, 2.4, 0.6))).toBe(false);
  });

  it('keeps those boxes out of the plain map renderer', () => {
    const all = buildMapObject(HEIST_MAP);
    const dressed = buildMapObject(HEIST_MAP, insideDressedBank(HEIST_MAP));
    const count = (o: typeof all, name: string) =>
      (o.getObjectByName(name) as { count?: number } | undefined)?.count ?? 0;
    expect(count(dressed, 'map-interior')).toBe(0);
    expect(count(all, 'map-interior')).toBeGreaterThan(0);
    expect(count(dressed, 'map-wall')).toBe(count(all, 'map-wall')); // the lot's walls stay
  });
});
