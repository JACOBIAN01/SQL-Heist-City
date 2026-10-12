import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { mergeByMaterial } from './mergeByMaterial';

const tris = (m: Mesh) => (m.geometry.index?.count ?? 0) / 3;

describe('mergeByMaterial', () => {
  const a = new MeshBasicMaterial();
  const b = new MeshBasicMaterial();

  it('makes one mesh per material, with the transforms baked in', () => {
    const root = new Group();
    root.position.set(10, 0, 0);
    for (let i = 0; i < 5; i++) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), a);
      m.position.set(i * 2, 0, 0);
      root.add(m);
    }
    const g = new Group();
    g.position.set(0, 5, 0);
    g.add(new Mesh(new SphereGeometry(1, 8, 6), b));
    root.add(g);
    const out = mergeByMaterial(root, 'merged');
    expect(out.name).toBe('merged');
    expect(out.children).toHaveLength(2);
    const boxes = out.children.find((c) => (c as Mesh).material === a) as Mesh;
    expect(tris(boxes)).toBe(60);
    out.children.forEach((c) => (c as Mesh).geometry.computeBoundingBox());
    // The first box sits at x = 10 (the root's offset), the last at x = 18.
    const bb = boxes.geometry.boundingBox;
    expect(bb?.min.x).toBeCloseTo(9.5);
    expect(bb?.max.x).toBeCloseTo(18.5);
    const ball = out.children.find((c) => (c as Mesh).material === b) as Mesh;
    ball.geometry.computeBoundingBox();
    expect(ball.geometry.boundingBox?.min.y).toBeCloseTo(4);
  });

  it('keeps render orders apart, and carries instanced and multi-material meshes over', () => {
    const root = new Group();
    const glass = new Mesh(new PlaneGeometry(), a);
    glass.renderOrder = 5;
    root.add(glass, new Mesh(new PlaneGeometry(), a), new InstancedMesh(new BoxGeometry(), b, 3));
    root.add(new Mesh(new BoxGeometry(), [a, a, a, a, a, a]));
    const out = mergeByMaterial(root);
    expect(out.children).toHaveLength(4);
    expect(out.children.map((c) => c.renderOrder).sort()).toEqual([0, 0, 0, 5]);
  });

  it('leaves the source tree as it was', () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), a), new Mesh(new BoxGeometry(), a));
    mergeByMaterial(root);
    expect(root.children).toHaveLength(2);
  });
});
