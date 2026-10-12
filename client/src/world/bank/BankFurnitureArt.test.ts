import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { BANK_1, BANK_LAYOUTS, placeFurniture, type GameMap } from '@heist/shared';
import { buildBankFurniture, ceilingLightSpots, CEILING_LIGHT } from './BankFurnitureArt';
import { interiorKitFrom } from './InteriorKit';

const shared = new MeshBasicMaterial();

function kitWith(ids: readonly string[]) {
  const scene = new Group();
  for (const id of ids) {
    const m = new Mesh(new BoxGeometry(), shared);
    m.name = id;
    scene.add(m);
  }
  return interiorKitFrom(scene, {
    version: 1,
    pieces: ids.map((id) => ({
      id,
      tris: 12,
      min: [0, 0, 0],
      max: [1, 1, 1],
      size: [1, 1, 1],
      glow: false,
    })),
  });
}

describe('buildBankFurniture', () => {
  const map = { banks: [{ tier: 1, x: 10, z: -8 }] } as unknown as GameMap;
  const placed = placeFurniture(BANK_1, { x: 10, z: -8 });
  const kit = kitWith([...new Set(placed.map((p) => p.piece))]);
  const storeyMeshes = (root: Group, storey: number) =>
    (root.children[0]?.children.find((c) => c.userData.storey === storey)?.children ??
      []) as Mesh[];
  const tris = (m: Mesh) => (m.geometry.index?.count ?? 0) / 3;

  it('merges each storey into one mesh with every piece in it, tagged with its bank and storey', () => {
    expect(placed.length).toBeGreaterThan(0);
    const root = buildBankFurniture(kit, map);
    for (let storey = 0; storey < BANK_1.storeys; storey++) {
      const here = placed.filter((p) => p.storey === storey);
      const meshes = storeyMeshes(root, storey);
      expect(meshes, `storey ${storey}`).toHaveLength(1); // the kit shares one material
      expect(tris(meshes[0] as Mesh)).toBe(here.length * 12);
    }
    const group = root.children[0]?.children[0];
    expect(group?.userData).toMatchObject({ bankTier: 1, storey: 0 });
  });

  it('puts every piece where the shared placement says', () => {
    const root = buildBankFurniture(kit, map);
    const mesh = storeyMeshes(root, 0)[0] as Mesh;
    mesh.geometry.computeBoundingBox();
    const here = placed.filter((p) => p.storey === 0);
    const box = mesh.geometry.boundingBox;
    expect(box?.min.x).toBeCloseTo(Math.min(...here.map((p) => p.x)) - 0.5, 0);
    expect(box?.max.x).toBeCloseTo(Math.max(...here.map((p) => p.x)) + 0.5, 0);
  });

  it('hangs door leaves and ceiling lamps into their storeys when the kit has them', () => {
    const rich = kitWith([...new Set(placed.map((p) => p.piece)), 'Door_1', CEILING_LIGHT]);
    const plain = buildBankFurniture(kit, map);
    const withExtras = buildBankFurniture(rich, map);
    const count = (root: Group, storey: number) => tris(storeyMeshes(root, storey)[0] as Mesh);
    // Storey 0: two leaves in the staff doorway, plus a grid of ceiling panels.
    expect(count(withExtras, 0)).toBeGreaterThan(count(plain, 0) + 2 * 12);
  });

  it("puts the top storey's ceiling lamps on the top storey, not above the roof", () => {
    const spots = ceilingLightSpots(BANK_1, { tier: 1, x: 10, z: -8 });
    const storeys = new Set(spots.map((s) => s.storey));
    expect([...storeys].sort()).toEqual([0, 1, 2]);
    for (const s of spots) expect(s.y).toBeLessThanOrEqual((s.storey + 1) * BANK_1.storeyHeight);
  });

  it('skips pieces the kit lacks and maps without banks', () => {
    const bare = buildBankFurniture(kitWith([]), map).children[0]?.children ?? [];
    expect(bare).toHaveLength(0);
    expect(buildBankFurniture(kitWith([]), {} as GameMap).children).toHaveLength(0);
    expect(BANK_LAYOUTS.get(1)).toBe(BANK_1);
  });
});
