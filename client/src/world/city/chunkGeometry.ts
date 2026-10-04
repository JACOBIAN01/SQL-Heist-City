import { BufferAttribute, BufferGeometry } from 'three';
import type { CityKit } from './CityKit';
import { wallNormal, type ChunkPlan, type GroundQuad, type Placement, type WallQuad } from './plan';

/** One chunk's art, merged: one geometry per kit material. */
export interface ChunkGeometry {
  readonly opaque: BufferGeometry;
  readonly decal?: BufferGeometry;
  readonly triangles: number;
}

/** Grows flat arrays of vertex data and turns them into a geometry at the end. */
class GeometryBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly layer: number[] = [];
  readonly index: number[] = [];

  get vertexCount(): number {
    return this.position.length / 3;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    layer: number,
  ): void {
    this.position.push(x, y, z);
    this.normal.push(nx, ny, nz);
    this.uv.push(u, v);
    this.layer.push(layer);
  }

  build(withLayer: boolean): BufferGeometry | undefined {
    if (this.index.length === 0) return undefined;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.position), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normal), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    if (withLayer) g.setAttribute('_layer', new BufferAttribute(new Float32Array(this.layer), 1));
    const big = this.vertexCount > 65535;
    g.setIndex(
      new BufferAttribute(big ? new Uint32Array(this.index) : new Uint16Array(this.index), 1),
    );
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Merges everything a chunk plan lists into one opaque and one decal
 * geometry: kit pieces moved into place, procedural ground and kerbs, each
 * window's fake interior swapped for the one the plan chose.
 * Pattern: Builder — Why: thousands of placements become two draw calls; the
 * plan stays pure data that tests can check without a GPU.
 */
export function buildChunkGeometry(kit: CityKit, plan: ChunkPlan): ChunkGeometry {
  const opaque = new GeometryBuilder();
  const decal = new GeometryBuilder();
  const defaultInterior = kit.layer('interior1');
  for (const p of plan.placements) {
    const g = kit.geometry(p.piece);
    const interior = p.interior ? kit.layer(p.interior) : defaultInterior;
    if (g.opaque) appendPiece(opaque, g.opaque, p, (l) => (l === defaultInterior ? interior : l));
    if (g.decal) appendPiece(decal, g.decal, p, () => 0);
  }
  for (const q of plan.ground) appendGround(opaque, q, kit.layer(q.layer));
  for (const w of plan.walls) appendWall(opaque, w, kit.layer(w.layer));
  const opaqueGeometry = opaque.build(true);
  const decalGeometry = decal.build(false);
  return {
    opaque: opaqueGeometry ?? new BufferGeometry(),
    ...(decalGeometry ? { decal: decalGeometry } : {}),
    triangles: (opaque.index.length + decal.index.length) / 3,
  };
}

function appendPiece(
  out: GeometryBuilder,
  g: BufferGeometry,
  p: Placement,
  layerOf: (layer: number) => number,
): void {
  const angle = (p.turn * Math.PI) / 2;
  // Rounded so quarter turns are exact (cos 90° is 6e-17 in floating point).
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const layer = g.getAttribute('_layer');
  const base = out.vertexCount;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nx = nrm.getX(i);
    const nz = nrm.getZ(i);
    out.vertex(
      p.x + cos * x + sin * z,
      p.y + pos.getY(i),
      p.z - sin * x + cos * z,
      cos * nx + sin * nz,
      nrm.getY(i),
      -sin * nx + cos * nz,
      uv ? uv.getX(i) : 0,
      uv ? uv.getY(i) : 0,
      layer ? layerOf(layer.getX(i)) : 0,
    );
  }
  const index = g.getIndex();
  if (index) for (let i = 0; i < index.count; i++) out.index.push(base + index.getX(i));
  else for (let i = 0; i < pos.count; i++) out.index.push(base + i);
}

/** A rectangle facing up; counter-clockwise seen from above, so it faces +y. */
function appendGround(out: GeometryBuilder, q: GroundQuad, layer: number): void {
  const r = q.rect;
  const base = out.vertexCount;
  for (const [x, z] of [
    [r.minX, r.minZ],
    [r.minX, r.maxZ],
    [r.maxX, r.maxZ],
    [r.maxX, r.minZ],
  ] as const)
    out.vertex(x, q.y, z, 0, 1, 0, x / q.tile, z / q.tile, layer);
  out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A vertical rectangle facing wallNormal(w). */
function appendWall(out: GeometryBuilder, w: WallQuad, layer: number): void {
  const n = wallNormal(w);
  const length = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z);
  const base = out.vertexCount;
  const corners = [
    [w.from, w.bottom, 0],
    [w.to, w.bottom, length],
    [w.to, w.top, length],
    [w.from, w.top, 0],
  ] as const;
  for (const [p, y, along] of corners)
    out.vertex(p.x, y, p.z, n.x, 0, n.z, along / w.tile, -y / w.tile, layer);
  out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
