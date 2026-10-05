import {
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  Sphere,
  type BufferGeometry,
  type Camera,
  type Object3D,
  type Scene,
} from 'three';

/** Where the triangles of a frame go, per top-level part of the scene. */
export interface BudgetRow {
  readonly part: string;
  readonly meshes: number;
  /** Triangles in view (the main pass). */
  readonly triangles: number;
  /** Of those, drawn again into the sun's shadow map. */
  readonly shadowTriangles: number;
}

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere();

function trianglesOf(geometry: BufferGeometry): number {
  const count = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
  const drawn = Number.isFinite(geometry.drawRange.count)
    ? Math.min(count, geometry.drawRange.count)
    : count;
  return drawn / 3;
}

function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Counts what the camera sees, mesh by mesh, grouped by the scene's
 * top-level objects (city, cars, players…): the perf pass uses it to find
 * what to cut. The shadow column is an upper bound (casters outside the
 * view can still cast into it).
 */
export function sceneBudget(scene: Scene, camera: Camera): BudgetRow[] {
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProjection);
  const rows = new Map<string, { meshes: number; triangles: number; shadowTriangles: number }>();
  for (const top of scene.children) {
    const part = top.name || top.type;
    const row = rows.get(part) ?? { meshes: 0, triangles: 0, shadowTriangles: 0 };
    rows.set(part, row);
    top.traverse((o) => {
      if (!(o instanceof Mesh) || !shown(o)) return;
      const geometry = o.geometry as BufferGeometry;
      if (o.frustumCulled && !(o instanceof InstancedMesh)) {
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        if (geometry.boundingSphere) {
          sphere.copy(geometry.boundingSphere).applyMatrix4(o.matrixWorld);
          if (!frustum.intersectsSphere(sphere)) return;
        }
      }
      const tris = trianglesOf(geometry) * (o instanceof InstancedMesh ? o.count : 1);
      row.meshes++;
      row.triangles += tris;
      if (o.castShadow) row.shadowTriangles += tris;
    });
  }
  return [...rows]
    .map(([part, r]) => ({ part, ...r }))
    .filter((r) => r.meshes > 0)
    .sort((a, b) => b.triangles - a.triangles);
}
