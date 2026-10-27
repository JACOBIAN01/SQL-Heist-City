import { describe, expect, it } from 'vitest';
import { citySettingsSchema, DEFAULT_CITY_SETTINGS, type CitySettings } from '../../config/city';
import { bankFootprint } from '../bank/banks';
import type { CityLayout, Rect } from './CityLayout';
import { generateCity } from './generateCity';

const city = (over: Partial<CitySettings> = {}): CityLayout =>
  generateCity(citySettingsSchema.parse({ ...DEFAULT_CITY_SETTINGS, ...over }), bankFootprint);

const overlaps = (a: Rect, b: Rect) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const inside = (a: Rect, b: Rect) =>
  a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ;
const centreOf = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

/** Every combination the tests sweep: several seeds at every allowed size. */
const SWEEP = [4, 5, 6, 8].flatMap((blocks) =>
  ['a', 'b', 'classroom-7', 'x9'].map((seed) => ({ blocks, seed })),
);

describe('generateCity: determinism', () => {
  it('builds the same city from the same seed', () => {
    expect(city({ seed: 'same' })).toEqual(city({ seed: 'same' }));
  });

  it('builds a different city from a different seed', () => {
    const a = city({ seed: 'one' });
    const b = city({ seed: 'two' });
    expect(a.blocks).not.toEqual(b.blocks);
  });
});

describe.each(SWEEP)('generateCity invariants ($blocks blocks, seed $seed)', (opts) => {
  const c = city(opts);
  const s = c.settings;

  it('lays out blocks × blocks blocks on the pitch, inside the wire-format range', () => {
    expect(c.blocks).toHaveLength(opts.blocks * opts.blocks);
    expect(c.halfSize).toBe((opts.blocks * s.blockPitch + s.streetWidth) / 2);
    expect(c.halfSize).toBeLessThan(650); // int16 × 2 cm positions
    for (const b of c.blocks) {
      expect(b.outer.maxX - b.outer.minX).toBe(s.blockPitch - s.streetWidth);
      expect(inside(b.inner, b.outer)).toBe(true);
    }
  });

  it('keeps every lot inside its block, apart from the others, on the 2 m grid', () => {
    for (const b of c.blocks) {
      expect(b.lots).toHaveLength(4);
      for (const lot of b.lots) {
        expect(inside(lot.rect, b.inner)).toBe(true);
        expect((lot.rect.maxX - lot.rect.minX) % 2).toBe(0);
        expect((lot.rect.maxZ - lot.rect.minZ) % 2).toBe(0);
        for (const other of b.lots)
          if (other !== lot) expect(overlaps(lot.rect, other.rect)).toBe(false);
        for (const bld of lot.buildings) {
          expect(inside(bld.rect, lot.rect)).toBe(true);
          expect(bld.storeys).toBeGreaterThanOrEqual(1);
          expect(bld.storeys).toBeLessThanOrEqual(bld.landmark ? s.landmarkStoreys : s.maxStoreys);
        }
      }
    }
  });

  it('has one bank per tier, in distinct blocks, with richer banks nearer the centre', () => {
    expect(c.banks.map((b) => b.tier)).toEqual([1, 2, 3, 4, 5]);
    const blockOf = (x: number, z: number) =>
      c.blocks.findIndex((b) => inside({ minX: x, maxX: x, minZ: z, maxZ: z }, b.inner));
    const blocks = c.banks.map((b) => blockOf(b.x, b.z));
    expect(new Set(blocks).size).toBe(5);
    const dist = (t: number) => {
      const b = c.banks[t - 1];
      return Math.hypot(b?.x ?? 0, b?.z ?? 0);
    };
    expect(dist(5)).toBeLessThan(dist(1));
    // Each bank's front (entrance side) is on the sidewalk line of its block.
    for (const bank of c.banks) {
      const block = c.blocks[blocks[c.banks.indexOf(bank)] ?? 0];
      expect(bank.z + bank.depth / 2).toBe(block?.inner.maxZ);
      const site = {
        minX: bank.x - bank.width / 2,
        maxX: bank.x + bank.width / 2,
        minZ: bank.z - bank.depth / 2,
        maxZ: bank.z + bank.depth / 2,
      };
      const lot = block?.lots.find((l) => l.use === 'bank');
      expect(lot && inside(site, lot.rect)).toBe(true);
    }
  });

  it('places the safehouses and hospital in blocks of their own, away from the banks', () => {
    expect(c.safehouses.map((h) => h.id)).toEqual(['safehouse-1', 'safehouse-2', 'safehouse-3']);
    const uses = c.blocks.map((b) =>
      b.lots.filter((l) => l.use !== 'building' && l.use !== 'plaza').map((l) => l.use),
    );
    expect(uses.filter((u) => u.length > 1)).toEqual([]);
    expect(uses.flat().sort()).toEqual([
      'bank',
      'bank',
      'bank',
      'bank',
      'bank',
      'hospital',
      'safehouse',
      'safehouse',
      'safehouse',
    ]);
    for (const h of c.safehouses)
      for (const bank of c.banks)
        expect(Math.hypot(h.x - bank.x, h.z - bank.z)).toBeGreaterThan(s.blockPitch / 2);
  });

  it('gives the hospital enough beds, in its forecourt, clear of the building', () => {
    const { beds, building } = c.hospital;
    expect(beds).toHaveLength(s.hospitalBeds);
    for (const bed of beds) {
      expect(bed.z).toBeGreaterThan(building.maxZ);
      expect(bed.x).toBeGreaterThan(building.minX);
      expect(bed.x).toBeLessThan(building.maxX);
    }
  });

  it('spawns players on the inner streets, never in a block or on the outer ring', () => {
    expect(c.spawns.length).toBeGreaterThanOrEqual(100);
    for (const p of c.spawns) {
      expect(Math.abs(p.x)).toBeLessThan(c.halfSize - s.streetWidth);
      expect(Math.abs(p.z)).toBeLessThan(c.halfSize - s.streetWidth);
      for (const b of c.blocks) {
        const inBlock =
          p.x > b.outer.minX && p.x < b.outer.maxX && p.z > b.outer.minZ && p.z < b.outer.maxZ;
        expect(inBlock).toBe(false);
      }
    }
  });

  it('builds taller downtown than on the outskirts, on average', () => {
    const avg = (pick: (d: number) => boolean) => {
      const heights = c.blocks
        .filter((b) => pick(Math.hypot(centreOf(b.inner).x, centreOf(b.inner).z)))
        .flatMap((b) => b.lots.flatMap((l) => l.buildings.map((x) => x.storeys)));
      return heights.reduce((a, h) => a + h, 0) / Math.max(1, heights.length);
    };
    const r = c.halfSize / 2;
    expect(avg((d) => d < r)).toBeGreaterThanOrEqual(avg((d) => d > r * 1.5));
  });
});

describe('citySettingsSchema', () => {
  it('rejects sizes outside 4–8 blocks and blocks too small to split', () => {
    expect(() => citySettingsSchema.parse({ blocks: 3 })).toThrow();
    expect(() => citySettingsSchema.parse({ blocks: 9 })).toThrow();
    expect(() => citySettingsSchema.parse({ blockPitch: 40 })).toThrow(/two lots/);
    expect(() => citySettingsSchema.parse({ minStoreys: 5, maxStoreys: 2 })).toThrow();
  });
});

describe('generateCity: districts (30.1)', () => {
  for (const { blocks, seed } of SWEEP) {
    it(`names every block's district and gives each district one taller landmark (${blocks} blocks, seed ${seed})`, () => {
      const c = city({ blocks, seed });
      const ids = new Set(c.districts.map((d) => d.id));
      expect(c.districts.length).toBeGreaterThanOrEqual(3);
      for (const b of c.blocks) expect(ids.has(b.district)).toBe(true);
      for (const d of c.districts) {
        const towers = c.blocks
          .filter((b) => b.district === d.id)
          .flatMap((b) => b.lots.flatMap((l) => l.buildings))
          .filter((x) => x.landmark);
        expect(towers.length, d.id).toBeLessThanOrEqual(1);
        if (d.landmark) {
          expect(towers).toHaveLength(1);
          expect(towers[0]?.storeys).toBeGreaterThanOrEqual(c.settings.landmarkStoreys);
        }
      }
    });
  }

  it('puts the corners in different districts and downtown in the middle', () => {
    const c = city({ blocks: 5 });
    const at = (ix: number, iz: number) =>
      c.blocks.find((b) => b.ix === ix && b.iz === iz)?.district;
    expect(at(2, 2)).toBe('downtown');
    expect(new Set([at(0, 0), at(4, 0), at(0, 4), at(4, 4)]).size).toBe(4);
  });

  it('does not change where the lots are: districts are a layer on top', () => {
    const c = city({ seed: 'keep' });
    const rects = c.blocks.flatMap((b) => b.lots.map((l) => l.rect));
    expect(rects).toEqual(city({ seed: 'keep' }).blocks.flatMap((b) => b.lots.map((l) => l.rect)));
  });
});
