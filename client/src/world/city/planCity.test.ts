import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANK_1, BANK_LAYOUTS, KERB_HEIGHT, mapById, type Rect } from '@heist/shared';
import { parseKitManifest } from './kitManifest';
import { subtractRects, wallNormal, type WallQuad } from './plan';
import { CORNICE_HEIGHT } from './facades';
import { planCity } from './planCity';

const city = mapById('city')?.city;
if (!city) throw new Error('no city layout');
const plans = planCity(city, BANK_LAYOUTS);
const kit = parseKitManifest(
  JSON.parse(readFileSync(join(__dirname, '../../../public/city/kit.json'), 'utf8')),
);
const area = (r: Rect) => (r.maxX - r.minX) * (r.maxZ - r.minZ);

describe('subtractRects', () => {
  it('covers exactly the rect minus the holes, without overlaps', () => {
    const rect = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const holes = [
      { minX: 2, maxX: 4, minZ: 2, maxZ: 8 },
      { minX: 6, maxX: 10, minZ: 0, maxZ: 3 },
    ];
    const parts = subtractRects(rect, holes);
    expect(parts.reduce((a, r) => a + area(r), 0)).toBe(100 - 12 - 12);
    for (const p of parts)
      for (const h of holes)
        expect(p.minX < h.maxX && h.minX < p.maxX && p.minZ < h.maxZ && h.minZ < p.maxZ).toBe(
          false,
        );
  });
});

describe('wallNormal', () => {
  it('faces the right-hand side of from → to, seen from above', () => {
    const w = (to: { x: number; z: number }): WallQuad => ({
      from: { x: 0, z: 0 },
      to,
      bottom: 0,
      top: 1,
      layer: 'x',
      tile: 1,
    });
    expect(wallNormal(w({ x: 1, z: 0 }))).toEqual({ x: -0, z: 1 }); // walking east, faces south
    expect(wallNormal(w({ x: 0, z: 1 }))).toEqual({ x: -1, z: 0 }); // walking south, faces west
  });
});

describe('planCity', () => {
  it('plans one chunk per block, the same way every time', () => {
    expect(plans).toHaveLength(city.blocks.length);
    expect(planCity(city, BANK_LAYOUTS)).toEqual(plans);
  });

  it('only uses pieces and layers the kit has', () => {
    for (const p of plans) {
      for (const pl of p.placements) {
        expect(kit.pieces[pl.piece], pl.piece).toBeDefined();
        if (pl.interior) expect(kit.interiorLayers).toContain(pl.interior);
      }
      for (const q of [...p.ground, ...p.walls]) expect(kit.layers).toContain(q.layer);
    }
  });

  it('paves every square metre of the city at street or kerb level, exactly once', () => {
    const paved = plans.flatMap((p) => p.ground.filter((q) => q.y <= KERB_HEIGHT));
    const total = paved.reduce((a, q) => a + area(q.rect), 0);
    expect(total).toBeCloseTo((2 * city.halfSize) ** 2, 3);
  });

  it('gives every building a shadow outline up to its cornice, banks included', () => {
    for (const p of plans)
      for (const m of p.masses)
        expect(p.casters).toContainEqual({ rect: m.rect, height: m.height + CORNICE_HEIGHT });
    // Bank 1 has a real interior, so no mass, but it still casts.
    const casters = plans.flatMap((p) => p.casters);
    const masses = plans.flatMap((p) => p.masses);
    expect(casters.length).toBeGreaterThan(masses.length);
  });

  it('keeps every placement in or at the edge of its chunk', () => {
    for (const p of plans)
      for (const pl of p.placements) {
        expect(pl.x).toBeGreaterThanOrEqual(p.bounds.minX - 1);
        expect(pl.x).toBeLessThanOrEqual(p.bounds.maxX + 1);
        expect(pl.z).toBeGreaterThanOrEqual(p.bounds.minZ - 1);
        expect(pl.z).toBeLessThanOrEqual(p.bounds.maxZ + 1);
      }
  });

  it('leaves Bank 1’s front door open', () => {
    const site = city.banks.find((b) => b.tier === 1);
    if (!site) throw new Error('no bank 1');
    const front = site.z + site.depth / 2;
    const doorX = site.x + BANK_1.entrance.x;
    const inDoor = plans
      .flatMap((p) => p.placements)
      .filter(
        (pl) =>
          pl.y === 0 &&
          pl.turn === 0 &&
          Math.abs(pl.z - front) < 0.5 &&
          Math.abs(pl.x - doorX) < BANK_1.entrance.width / 2 + 1,
      );
    expect(inDoor).toEqual([]);
  });

  it('marks the roads: centre lines and a crosswalk at each end of every segment', () => {
    const decals = plans.flatMap((p) => p.placements).filter((pl) => pl.piece.startsWith('Decal_'));
    const segments = 2 * (city.settings.blocks + 1) * city.settings.blocks;
    expect(decals.filter((d) => d.piece === 'Decal_Crosswalk_Wide')).toHaveLength(2 * segments);
    expect(decals.filter((d) => d.piece === 'Decal_DoubleYellow_Straight').length).toBeGreaterThan(
      segments * 5,
    );
  });

  it('keeps the whole city under the triangle budget the LOD pass works from', () => {
    const tris = plans
      .flatMap((p) => p.placements)
      .reduce((a, pl) => a + (kit.pieces[pl.piece]?.tris ?? 0), 0);
    // ≈ 30k per block on average; streaming and impostors (8.4) keep what is drawn under 400k.
    expect(tris).toBeLessThan(900_000);
  });
});
