import { Group, Mesh } from 'three';
import type { BankLayout, CityLayout } from '@heist/shared';
import type { CityKit } from './CityKit';
import { buildChunkGeometry } from './chunkGeometry';
import { planCity } from './planCity';

export interface CityArtStats {
  readonly chunks: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

/**
 * The whole city drawn with kit pieces: one group per block (chunk), each
 * with at most two meshes. Chunks keep their ground bounds in userData so
 * streaming and LOD (8.4) can switch them on and off.
 */
export function buildCityArt(
  kit: CityKit,
  city: CityLayout,
  bankLayouts: ReadonlyMap<number, BankLayout>,
): { root: Group; stats: CityArtStats } {
  const root = new Group();
  root.name = 'city-art';
  let triangles = 0;
  let drawCalls = 0;
  for (const plan of planCity(city, bankLayouts)) {
    const geometry = buildChunkGeometry(kit, plan);
    const chunk = new Group();
    chunk.name = plan.id;
    chunk.userData.bounds = plan.bounds;
    const body = new Mesh(geometry.opaque, kit.materials.opaque);
    body.castShadow = true;
    body.receiveShadow = true;
    chunk.add(body);
    drawCalls++;
    if (geometry.decal) {
      const marks = new Mesh(geometry.decal, kit.materials.decal);
      marks.receiveShadow = true;
      chunk.add(marks);
      drawCalls++;
    }
    triangles += geometry.triangles;
    root.add(chunk);
  }
  return { root, stats: { chunks: root.children.length, triangles, drawCalls } };
}
