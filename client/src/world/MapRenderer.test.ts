import { describe, expect, it } from 'vitest';
import { InstancedMesh } from 'three';
import { TEST_MAP } from '@heist/shared';
import { buildMapObject } from './MapRenderer';

describe('buildMapObject', () => {
  it('batches every box of a kind into one instanced mesh', () => {
    const root = buildMapObject(TEST_MAP);
    const instanced = root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    const kinds = new Set(TEST_MAP.boxes.map((b) => b.kind));
    expect(instanced).toHaveLength(kinds.size);
    expect(instanced.reduce((n, m) => n + m.count, 0)).toBe(TEST_MAP.boxes.length);
  });

  it('keeps draw calls tiny: ground plus one per kind', () => {
    expect(buildMapObject(TEST_MAP).children.length).toBeLessThanOrEqual(8);
  });
});
