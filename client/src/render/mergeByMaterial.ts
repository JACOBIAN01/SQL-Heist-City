import {
  Group,
  InstancedMesh,
  Mesh,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Flattens a tree of static meshes into one mesh per material (and render
 * order), with every mesh's transform baked into its vertices, so a room of
 * a hundred small pieces costs a handful of draw calls. Meshes with several
 * materials, instanced meshes and meshes whose attributes differ from the rest
 * are carried over untouched. The tree itself is left as it was.
 * Pattern: Flyweight-style batching — Why: the bank interiors are static,
 * so the per-object draw calls buy nothing and the budget is draw calls.
 */
export function mergeByMaterial(root: Object3D, name = root.name): Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: Material; order: number; parts: BufferGeometry[] }>();
  const leftovers: Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o instanceof InstancedMesh || Array.isArray(o.material)) {
      leftovers.push(o);
      return;
    }
    const material = o.material as Material;
    const key = `${material.uuid}/${o.renderOrder}`;
    const bucket = buckets.get(key) ?? { material, order: o.renderOrder, parts: [] };
    buckets.set(key, bucket);
    const g = (o.geometry as BufferGeometry).clone();
    g.applyMatrix4(o.matrixWorld);
    bucket.parts.push(g);
  });
  const out = new Group();
  out.name = name;
  for (const { material, order, parts } of buckets.values()) {
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    const geometries = merged ? [merged] : parts; // attributes differ: keep them apart
    for (const geometry of geometries) {
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = order;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      out.add(mesh);
    }
  }
  for (const mesh of leftovers) {
    const copy = mesh.clone();
    copy.applyMatrix4(mesh.matrixWorld);
    copy.matrixAutoUpdate = true;
    out.add(copy);
  }
  return out;
}
