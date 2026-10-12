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
    // The pieces, then the group of door leaves (empty here: this kit has no door).
    expect(meshes).toHaveLength(placed.length + 1);
    expect(meshes[placed.length]?.name).toBe('bank-doors-bank-1');
    placed.forEach((p, i) => {
      const m = meshes[i];
      expect(m?.name).toBe(p.piece);
      expect(m?.position.toArray()).toEqual([p.x, p.y, p.z]);
      expect(m?.rotation.y).toBeCloseTo(p.yaw);
      expect(m?.scale.x).toBe(p.scale);
    });
  });

  it('hangs a pair of door leaves in each interior doorway when the kit has a door', () => {
    const root = buildBankFurniture(kitWith(['Door_1']), map);
    const doors = root.children[0]?.children.find((c) => c.name === 'bank-doors-bank-1');
    expect(doors?.children).toHaveLength(2);
    expect(doors?.children[0]?.name).toBe('Door_1');
  });

  it('skips pieces the kit lacks and maps without banks', () => {
    const bare = buildBankFurniture(kitWith([]), map).children[0]?.children ?? [];
    expect(bare.map((c) => c.children.length)).toEqual([0]); // only the empty door group
    expect(buildBankFurniture(kitWith([]), {} as GameMap).children).toHaveLength(0);
    expect(BANK_LAYOUTS.get(1)).toBe(BANK_1);
  });
});
