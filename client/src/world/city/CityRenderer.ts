import { Group, Mesh } from 'three';
import type { BankLayout, CityLayout, Rect } from '@heist/shared';
import type { CityKit } from './CityKit';
import { buildChunkGeometry, buildImpostorGeometry } from './chunkGeometry';
import type { ChunkPlan } from './plan';
import { planCity, planOutskirts } from './planCity';

export interface StreamSettings {
  /** A chunk this close to the camera (m, to its nearest edge) is drawn in full kit detail. */
  readonly detailRange: number;
  /** …and stays detailed until it is this far: the gap stops chunks flickering at the boundary. */
  readonly detailExit: number;
  /** Beyond this nothing is drawn (the fog has hidden it; the camera's far plane is 220 m). */
  readonly drawRange: number;
  /** Detailed chunks built per update: building one takes a few ms, so this caps a frame's hitch. */
  readonly buildsPerUpdate: number;
}

export const DEFAULT_STREAM: StreamSettings = {
  detailRange: 72,
  detailExit: 86,
  drawRange: 230,
  buildsPerUpdate: 1,
};

export interface StreamStats {
  readonly chunks: number;
  readonly detailed: number;
  readonly impostors: number;
  readonly hidden: number;
  /** Chunks whose detailed geometry exists (built once, kept). */
  readonly built: number;
  /** Meshes on screen this frame, before frustum culling: the city's share of draw calls. */
  readonly drawCalls: number;
}

/** Distance (m) from (x, z) to the nearest point of a rect; 0 inside it. */
export function distanceToRect(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

class StreamedChunk {
  readonly group = new Group();
  detail: Group | undefined;
  readonly impostor: Mesh;
  showingDetail = false;

  constructor(
    readonly plan: ChunkPlan,
    kit: CityKit,
  ) {
    this.group.name = plan.id;
    this.group.userData.bounds = plan.bounds;
    // Far away a chunk neither casts nor needs sharp shadows: the shadow map only covers ~45 m anyway.
    this.impostor = new Mesh(buildImpostorGeometry(kit, plan).opaque, kit.materials.opaque);
    this.impostor.name = `${plan.id}-impostor`;
    this.impostor.receiveShadow = true;
    this.group.add(this.impostor);
  }

  build(kit: CityKit): void {
    const geometry = buildChunkGeometry(kit, this.plan);
    const detail = new Group();
    detail.name = `${this.plan.id}-detail`;
    const body = new Mesh(geometry.opaque, kit.materials.opaque);
    body.castShadow = true;
    body.receiveShadow = true;
    detail.add(body);
    if (geometry.decal) {
      const marks = new Mesh(geometry.decal, kit.materials.decal);
      marks.receiveShadow = true;
      detail.add(marks);
    }
    detail.visible = false;
    this.detail = detail;
    this.group.add(detail);
  }
}

/**
 * Draws the city around the camera: near chunks in full kit detail, the rest
 * as cheap box impostors, nothing past the fog. Detail is built on demand, a
 * chunk at a time, so walking across the city never stalls a frame for long.
 * Pattern: Proxy (the impostor stands in for a chunk's real geometry until it
 * is needed and built) — Why: the whole city in detail is ~0.9M triangles;
 * only the few chunks around the player ever need it.
 */
export class CityStreamer {
  readonly root = new Group();
  private readonly chunks: StreamedChunk[];

  constructor(
    private readonly kit: CityKit,
    plans: readonly ChunkPlan[],
    private readonly settings: StreamSettings = DEFAULT_STREAM,
  ) {
    this.root.name = 'city-art';
    this.chunks = plans.map((p) => new StreamedChunk(p, kit));
    for (const c of this.chunks) this.root.add(c.group);
  }

  /** Builds every chunk the camera at (x, z) needs in detail, at once: call before the first frame. */
  prime(x: number, z: number): void {
    for (const c of this.chunks)
      if (!c.detail && distanceToRect(c.plan.bounds, x, z) < this.settings.detailRange)
        c.build(this.kit);
    this.update(x, z);
  }

  /** Call every frame with the camera's position. */
  update(x: number, z: number): void {
    const queue: { chunk: StreamedChunk; d: number }[] = [];
    for (const c of this.chunks) {
      const d = distanceToRect(c.plan.bounds, x, z);
      c.group.visible = d < this.settings.drawRange;
      const want =
        c.group.visible &&
        d < (c.showingDetail ? this.settings.detailExit : this.settings.detailRange);
      if (want && !c.detail) queue.push({ chunk: c, d });
      c.showingDetail = want && c.detail !== undefined;
      if (c.detail) c.detail.visible = c.showingDetail;
      c.impostor.visible = !c.showingDetail;
    }
    queue.sort((a, b) => a.d - b.d);
    for (const { chunk } of queue.slice(0, this.settings.buildsPerUpdate)) chunk.build(this.kit);
  }

  get stats(): StreamStats {
    let detailed = 0;
    let impostors = 0;
    let hidden = 0;
    let built = 0;
    let drawCalls = 0;
    for (const c of this.chunks) {
      if (c.detail) built++;
      if (!c.group.visible) hidden++;
      else if (c.showingDetail) {
        detailed++;
        drawCalls += c.detail?.children.length ?? 0;
      } else {
        impostors++;
        drawCalls++;
      }
    }
    return { chunks: this.chunks.length, detailed, impostors, hidden, built, drawCalls };
  }
}

/** The streamed art for a city: its blocks plus the ring of buildings outside the wall. */
export function createCityArt(
  kit: CityKit,
  city: CityLayout,
  bankLayouts: ReadonlyMap<number, BankLayout>,
  settings: StreamSettings = DEFAULT_STREAM,
): CityStreamer {
  return new CityStreamer(kit, [...planCity(city, bankLayouts), ...planOutskirts(city)], settings);
}
