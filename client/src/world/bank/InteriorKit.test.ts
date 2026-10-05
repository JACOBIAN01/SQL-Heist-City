import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { FURNITURE_PIECES } from '@heist/shared';
import { interiorKitFrom, type InteriorManifest } from './InteriorKit';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../../public/interior/interior.json'), 'utf8'),
) as InteriorManifest;
const piece = (id: string) => {
  const p = manifest.pieces.find((x) => x.id === id);
  if (!p) throw new Error(`missing ${id}`);
  return p;
};

describe('interior.json (the built furniture)', () => {
  it('has the pieces the banks are dressed with', () => {
    const ids = manifest.pieces.map((p) => p.id);
    for (const id of [
      'Column_Round3',
      'Door_Double',
      'Light_Chandelier',
      'Light_Ceiling5',
      'Chair_1',
      'Couch_Large1',
      'Table_RoundLarge',
      'Drawer_3',
      'Bookshelf',
      'Houseplant_8',
      'Carpet_1',
    ])
      expect(ids).toContain(id);
  });

  it('is life size: doors about 2.1 m, chairs under a metre, columns fit a 2.7 m ceiling', () => {
    expect(piece('Door_Double').size[1]).toBeCloseTo(2.1, 1);
    expect(piece('Chair_1').size[1]).toBeLessThan(1);
    expect(piece('Table_RoundLarge').size[1]).toBeGreaterThan(0.65);
    expect(piece('Column_Round3').size[1]).toBeLessThanOrEqual(2.72);
    expect(piece('Light_Chandelier').max[1]).toBeCloseTo(0, 2);
    expect(piece('Light_Chandelier').glow).toBe(true);
  });

  it('stands every piece on y = 0, and hangs ceiling lights from it', () => {
    for (const p of manifest.pieces) {
      const hangs = Math.abs(p.max[1]) < 0.005;
      if (hangs) expect(p.id).toMatch(/^Light_/);
      else expect(p.min[1]).toBeCloseTo(0, 2);
      expect(p.size.every((s) => s > 0)).toBe(true);
    }
  });

  it('matches the bounds the shared layout code uses (FURNITURE_PIECES)', () => {
    expect(Object.keys(FURNITURE_PIECES).sort()).toEqual(manifest.pieces.map((p) => p.id).sort());
    for (const p of manifest.pieces) {
      const shared = FURNITURE_PIECES[p.id as keyof typeof FURNITURE_PIECES];
      expect(shared.min, p.id).toEqual(p.min);
      expect(shared.max, p.id).toEqual(p.max);
    }
  });

  it('stays small: under 40k triangles in all', () => {
    expect(manifest.pieces.reduce((n, p) => n + p.tris, 0)).toBeLessThan(40_000);
  });
});

describe('interiorKitFrom', () => {
  const scene = new Group();
  const chair = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  chair.name = 'Chair_1';
  scene.add(chair);
  const kit = interiorKitFrom(scene, {
    version: 1,
    pieces: [
      { id: 'Chair_1', tris: 12, min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], glow: false },
      { id: 'Ghost', tris: 1, min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], glow: false },
    ],
  });

  it('lists only pieces that are in both the file and the manifest', () => {
    expect(kit.pieceIds).toEqual(['Chair_1']);
    expect(kit.has('Ghost')).toBe(false);
  });

  it('makes meshes that share the geometry and the one kit material', () => {
    const a = kit.create('Chair_1');
    const b = kit.create('Chair_1');
    expect(a.geometry).toBe(chair.geometry);
    expect(a.material).toBe(kit.material);
    expect(b.material).toBe(a.material);
    expect(() => kit.create('Sofa_9')).toThrow();
  });
});
