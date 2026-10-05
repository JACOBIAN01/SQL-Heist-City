import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { BANK_1, BANK_LAYOUTS, placeFurniture, type GameMap } from '@heist/shared';
import { buildBankFurniture } from './BankFurnitureArt';
import { interiorKitFrom } from './InteriorKit';

function kitWith(ids: readonly string[]) {
  const scene = new Group();
  for (const id of ids) {
    const m = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
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

  it("places each bank's pieces where the shared placement says, turned and scaled", () => {
    const placed = placeFurniture(BANK_1, { x: 10, z: -8 });
    expect(placed.length).toBeGreaterThan(0);
    const kit = kitWith([...new Set(placed.map((p) => p.piece))]);
    const root = buildBankFurniture(kit, map);
    const meshes = root.children[0]?.children ?? [];
    expect(meshes).toHaveLength(placed.length);
    placed.forEach((p, i) => {
      const m = meshes[i];
      expect(m?.name).toBe(p.piece);
      expect(m?.position.toArray()).toEqual([p.x, p.y, p.z]);
      expect(m?.rotation.y).toBeCloseTo(p.yaw);
      expect(m?.scale.x).toBe(p.scale);
    });
  });

  it('skips pieces the kit lacks and maps without banks', () => {
    expect(buildBankFurniture(kitWith([]), map).children[0]?.children).toHaveLength(0);
    expect(buildBankFurniture(kitWith([]), {} as GameMap).children).toHaveLength(0);
    expect(BANK_LAYOUTS.get(1)).toBe(BANK_1);
  });
});
