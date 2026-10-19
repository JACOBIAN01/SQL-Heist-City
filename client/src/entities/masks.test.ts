import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import { MASK_SHAPES } from '@heist/shared';
import { createMask } from './masks';

describe('masks', () => {
  it('builds every shape, named, in the colour asked for, and small', () => {
    for (const shape of MASK_SHAPES) {
      const mask = createMask(shape, 0x2980b9);
      expect(mask.name).toBe(`mask-${shape}`);
      const meshes: Mesh[] = [];
      mask.traverse((n) => (n as Mesh).isMesh && meshes.push(n as Mesh));
      expect(meshes.length).toBeGreaterThan(0);
      expect((meshes[0]?.material as MeshStandardMaterial).color.getHex()).toBe(0x2980b9);
      // At most a few boxes: a masked crowd must stay cheap.
      expect(meshes.length).toBeLessThanOrEqual(3);
    }
  });

  it('shares geometry between wearers', () => {
    const a = createMask('visor', 1).children[0] as Mesh;
    const b = createMask('visor', 2).children[0] as Mesh;
    expect(a.geometry).toBe(b.geometry);
  });
});
