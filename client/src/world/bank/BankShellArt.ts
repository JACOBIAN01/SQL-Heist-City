import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import {
  BANK_LAYOUTS,
  compileBankParts,
  type Aabb,
  type BankLayout,
  type FloorFinish,
  type GameMap,
  type MapBox,
  type PlacedBank,
  type WallFinish,
} from '@heist/shared';
import { SURFACES, type BankMaterials, type BankSurface } from './bankMaterials';

type Vec3 = readonly [number, number, number];
interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const FLOOR_SURFACE: Readonly<Record<FloorFinish, BankSurface>> = {
  marble: 'marble',
  wood: 'wood',
  carpet: 'carpet',
  tile: 'tile',
  steel: 'steel',
};
const WALL_SURFACE: Readonly<Record<WallFinish, BankSurface>> = {
  plaster: 'plaster',
  panel: 'panel',
  steel: 'steelWall',
  marble: 'marbleWall',
};
/** The surfaces that meet the sun: the cladding and the roof. */
const OUTDOOR: ReadonlySet<BankSurface> = new Set([
  'stone',
  'sandstone',
  'granite',
  'limestone',
  'whitestone',
  'roof',
]);
/** Ground-floor finish lifted off the street plane, so the two never fight. */
const GROUND_LIFT = 0.01;
/** Door surrounds: how far they reach past the opening, and how far they stand off the wall. */
const ARCHITRAVE = 0.1;
const ARCHITRAVE_DEPTH = 0.03;

/** Triangles for one surface, gathered from every face drawn with it. */
class SurfaceBatch {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];

  /** Adds a quad (corners in order around it) facing `n`; flips the winding if needed. */
  quad(corners: readonly Vec3[], n: Vec3, uvOf: (p: Vec3) => readonly [number, number]): void {
    const [a, b, c, d] = corners as [Vec3, Vec3, Vec3, Vec3];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
      (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
      (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
    ];
    const facing = (cross[0] ?? 0) * n[0] + (cross[1] ?? 0) * n[1] + (cross[2] ?? 0) * n[2];
    const order = facing >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of order) {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(n[0], n[1], n[2]);
      const [u, v] = uvOf(p);
      this.uv.push(u, v);
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** One face of a box: its corners, outward normal and centre. */
interface Face {
  readonly corners: Vec3[];
  readonly n: Vec3;
  readonly centre: Vec3;
}

function facesOf(b: Aabb): Face[] {
  const { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 } = b;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  return [
    {
      n: [1, 0, 0],
      centre: [x1, cy, cz],
      corners: [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
    },
    {
      n: [-1, 0, 0],
      centre: [x0, cy, cz],
      corners: [
        [x0, y0, z1],
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
      ],
    },
    {
      n: [0, 0, 1],
      centre: [cx, cy, z1],
      corners: [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    },
    {
      n: [0, 0, -1],
      centre: [cx, cy, z0],
      corners: [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
    },
    {
      n: [0, 1, 0],
      centre: [cx, y1, cz],
      corners: [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    },
    {
      n: [0, -1, 0],
      centre: [cx, y0, cz],
      corners: [
        [x0, y0, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y0, z0],
      ],
    },
  ];
}

/** `r` minus `cut`: up to four rectangles. */
export function subtractRect(r: Rect, cut: Rect): Rect[] {
  const minX = Math.max(r.minX, cut.minX);
  const maxX = Math.min(r.maxX, cut.maxX);
  const minZ = Math.max(r.minZ, cut.minZ);
  const maxZ = Math.min(r.maxZ, cut.maxZ);
  if (minX >= maxX || minZ >= maxZ) return [r];
  const out: Rect[] = [];
  if (r.minZ < minZ) out.push({ ...r, maxZ: minZ });
  if (maxZ < r.maxZ) out.push({ ...r, minZ: maxZ });
  if (r.minX < minX) out.push({ minX: r.minX, maxX: minX, minZ, maxZ });
  if (maxX < r.maxX) out.push({ minX: maxX, maxX: r.maxX, minZ, maxZ });
  return out;
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const r = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
  return r.minX < r.maxX && r.minZ < r.maxZ ? r : undefined;
}

/**
 * Dresses one bank's shell and rooms: real floors (marble, wood, carpet,
 * tile, steel), walls with a wainscot and skirting (or steel in the vault),
 * ceilings, stone outside, a roof, door surrounds. Built from the same
 * compiled boxes the simulation collides with, so every surface sits on a
 * collider; nothing here changes play.
 */
export class BankShellBuilder {
  private readonly batches = new Map<BankSurface, SurfaceBatch>();
  private readonly h: number;
  private readonly hw: number;
  private readonly hd: number;

  constructor(
    private readonly layout: BankLayout,
    private readonly site: PlacedBank,
  ) {
    this.h = layout.storeyHeight;
    this.hw = layout.width / 2;
    this.hd = layout.depth / 2;
  }

  build(materials: BankMaterials): Group {
    const parts = compileBankParts(this.layout, this.site);
    for (const b of parts.shell) this.wall(b, true);
    for (const b of parts.walls) this.wall(b, false);
    for (const b of parts.roof) this.roof(b);
    for (const b of parts.slabs) this.slab(b);
    for (const b of parts.steps) this.box(b, (f) => (f.n[1] < 0 ? undefined : 'marble'));
    for (const b of parts.blocks) {
      const tall = b.maxY - b.minY >= 2;
      this.box(b, (f) => (f.n[1] < 0 ? undefined : f.n[1] > 0 || tall ? 'marble' : 'counter'));
    }
    this.floors(parts.slabs);
    this.doorSurrounds();
    const group = new Group();
    group.name = `bank-shell-${this.layout.id}`;
    for (const [surface, batch] of this.batches) {
      if (batch.position.length === 0) continue;
      const mesh = new Mesh(batch.geometry(), materials[surface]);
      mesh.name = `bank-${surface}`;
      // Only the outside meets the sun. Indoors is under the roof's shadow anyway and lights
      // itself (selfLight); taking shadows there only adds acne on ceilings.
      const outdoor = OUTDOOR.has(surface);
      mesh.castShadow = outdoor;
      mesh.receiveShadow = outdoor;
      group.add(mesh);
    }
    return group;
  }

  /** Triangles per surface, for tests and the perf overlay. */
  surfaces(): ReadonlyMap<BankSurface, number> {
    return new Map([...this.batches].map(([k, b]) => [k, b.position.length / 9]));
  }

  private batch(surface: BankSurface): SurfaceBatch {
    let b = this.batches.get(surface);
    if (!b) this.batches.set(surface, (b = new SurfaceBatch()));
    return b;
  }

  /** Texture coordinates for a point on a face, by the surface's mapping. */
  private uv(
    surface: BankSurface,
    n: Vec3,
    floorY: number,
  ): (p: Vec3) => readonly [number, number] {
    const style = SURFACES[surface];
    const vertical = n[1] === 0;
    if (style.uv === 'storey' && vertical) {
      // Across: metres along the wall over one storey; up: height within the storey.
      return (p) => [(n[0] !== 0 ? p[2] : p[0]) / this.h, (p[1] - floorY) / this.h];
    }
    const s = style.size;
    if (!vertical) return (p) => [p[0] / s, p[2] / s];
    return (p) => [(n[0] !== 0 ? p[2] : p[0]) / s, p[1] / s];
  }

  private add(surface: BankSurface, f: Face, floorY: number): void {
    this.batch(surface).quad(f.corners, f.n, this.uv(surface, f.n, floorY));
  }

  private storeyAt(y: number): number {
    return Math.max(0, Math.min(this.layout.storeys - 1, Math.floor((y + 1e-3) / this.h)));
  }

  /** The room finish at a world point on a storey (local rooms, world point). */
  private roomAt(storey: number, x: number, z: number) {
    const lx = x - this.site.x;
    const lz = z - this.site.z;
    // Later rooms win, so a small room inside a big one keeps its own finish.
    return [...(this.layout.rooms ?? [])]
      .reverse()
      .find(
        (r) =>
          r.storey === storey &&
          Math.abs(lx - r.x) <= r.width / 2 &&
          Math.abs(lz - r.z) <= r.depth / 2,
      );
  }

  private wallSurface(storey: number, x: number, z: number): BankSurface {
    return WALL_SURFACE[this.roomAt(storey, x, z)?.walls ?? 'plaster'];
  }

  private outside(x: number, z: number): boolean {
    return Math.abs(x - this.site.x) > this.hw || Math.abs(z - this.site.z) > this.hd;
  }

  /** A wall piece: each side takes the finish of the room it faces; the outside is stone. */
  private wall(b: Aabb, exterior: boolean): void {
    const storey = this.storeyAt(b.minY);
    const floorY = storey * this.h;
    for (const f of facesOf(b)) {
      if (f.n[1] !== 0) {
        // Only the undersides of lintels and tops of sills show.
        const lintel = f.n[1] < 0 && b.minY > floorY + 0.01;
        const sill = f.n[1] > 0 && b.maxY < floorY + this.h - 0.01;
        if (lintel || sill) this.add('trim', f, floorY);
        continue;
      }
      // A long wall can face several rooms: cut it where rooms begin and end.
      for (const piece of this.splitByRooms(f, storey)) {
        const px = piece.centre[0] + piece.n[0] * 0.3;
        const pz = piece.centre[2] + piece.n[2] * 0.3;
        if (exterior && this.outside(px, pz))
          this.add(this.layout.cladding ?? 'stone', piece, floorY);
        else this.add(this.wallSurface(storey, px, pz), piece, floorY);
      }
    }
  }

  /** A vertical face cut at every room edge that crosses it, so each piece faces one room. */
  private splitByRooms(f: Face, storey: number): Face[] {
    const alongX = f.n[0] === 0; // a face looking along z runs along x
    const coords = f.corners.map((c) => (alongX ? c[0] : c[2]));
    const lo = Math.min(...coords);
    const hi = Math.max(...coords);
    const offset = alongX ? this.site.x : this.site.z;
    const cuts = (this.layout.rooms ?? [])
      .filter((r) => r.storey === storey)
      .flatMap((r) =>
        alongX ? [r.x - r.width / 2, r.x + r.width / 2] : [r.z - r.depth / 2, r.z + r.depth / 2],
      )
      .map((c) => c + offset)
      .filter((c) => c > lo + 1e-6 && c < hi - 1e-6)
      .sort((a, b) => a - b);
    if (cuts.length === 0) return [f];
    const ys = f.corners.map((c) => c[1]);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const fixed = alongX ? (f.corners[0]?.[2] ?? 0) : (f.corners[0]?.[0] ?? 0);
    const edges = [lo, ...cuts, hi];
    const out: Face[] = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i] as number;
      const b = edges[i + 1] as number;
      const p = (u: number, y: number): Vec3 => (alongX ? [u, y, fixed] : [fixed, y, u]);
      out.push({
        n: f.n,
        corners: [p(a, y0), p(b, y0), p(b, y1), p(a, y1)],
        centre: p((a + b) / 2, (y0 + y1) / 2),
      });
    }
    return out;
  }

  private roof(b: Aabb): void {
    for (const f of facesOf(b))
      this.add(
        f.n[1] > 0 ? 'roof' : f.n[1] < 0 ? 'ceiling' : (this.layout.cladding ?? 'stone'),
        f,
        0,
      );
  }

  /** A floor slab: its underside is the ceiling below; its edges show only round the stair holes. */
  private slab(b: Aabb): void {
    const storey = this.storeyAt(b.maxY) - 1;
    for (const f of facesOf(b)) {
      if (f.n[1] < 0) this.add('ceiling', f, 0);
      else if (f.n[1] === 0) {
        const px = f.centre[0] + f.n[0] * 0.3;
        const pz = f.centre[2] + f.n[2] * 0.3;
        if (!this.outside(px, pz) && !this.nearShell(px, pz))
          this.add(this.wallSurface(Math.max(0, storey), px, pz), f, b.minY);
      }
    }
  }

  private nearShell(x: number, z: number): boolean {
    return Math.abs(x - this.site.x) > this.hw - 0.5 || Math.abs(z - this.site.z) > this.hd - 0.5;
  }

  private box(b: Aabb, pick: (f: Face) => BankSurface | undefined): void {
    for (const f of facesOf(b)) {
      const s = pick(f);
      if (s) this.add(s, f, 0);
    }
  }

  /** Every storey's floor, split by room so each room gets its finish and nothing overlaps. */
  private floors(slabs: readonly Aabb[]): void {
    const local = (r: Rect): Rect => ({
      minX: r.minX - this.site.x,
      maxX: r.maxX - this.site.x,
      minZ: r.minZ - this.site.z,
      maxZ: r.maxZ - this.site.z,
    });
    for (let s = 0; s < this.layout.storeys; s++) {
      const y = s === 0 ? GROUND_LIFT : s * this.h;
      let rest: Rect[] =
        s === 0
          ? [{ minX: -this.hw, maxX: this.hw, minZ: -this.hd, maxZ: this.hd }]
          : slabs.filter((b) => Math.abs(b.maxY - s * this.h) < 1e-6).map(local);
      const rooms = (this.layout.rooms ?? []).filter((r) => r.storey === s);
      // Later rooms win: carve them out first.
      for (const room of [...rooms].reverse()) {
        const r: Rect = {
          minX: room.x - room.width / 2,
          maxX: room.x + room.width / 2,
          minZ: room.z - room.depth / 2,
          maxZ: room.z + room.depth / 2,
        };
        const finish = FLOOR_SURFACE[room.floor ?? (s === 0 ? 'marble' : 'carpet')];
        for (const piece of rest.flatMap((p) => (intersect(p, r) ? [intersect(p, r) as Rect] : [])))
          this.floorQuad(piece, y, finish);
        rest = rest.flatMap((p) => subtractRect(p, r));
      }
      for (const piece of rest) this.floorQuad(piece, y, s === 0 ? 'marble' : 'carpet');
    }
  }

  private floorQuad(r: Rect, y: number, surface: BankSurface): void {
    const x0 = r.minX + this.site.x;
    const x1 = r.maxX + this.site.x;
    const z0 = r.minZ + this.site.z;
    const z1 = r.maxZ + this.site.z;
    this.batch(surface).quad(
      [
        [x0, y, z0],
        [x1, y, z0],
        [x1, y, z1],
        [x0, y, z1],
      ],
      [0, 1, 0],
      this.uv(surface, [0, 1, 0], 0),
    );
  }

  /** A wooden surround round every interior door and the street door, on both faces of the wall. */
  private doorSurrounds(): void {
    this.layout.floors.forEach((plan, storey) => {
      for (const w of plan.walls)
        for (const o of w.openings ?? []) {
          if ((o.sill ?? 0) > 0) continue; // a window or pass-through, not a door
          if (this.isVaultDoorway(w, o, storey)) continue; // the vault door has its own frame
          this.surround(w.from, w.to, w.thickness ?? 0.2, o.at, o.width, o.height, storey);
        }
    });
    const e = this.layout.entrance;
    this.surround(
      { x: -this.hw, z: this.hd },
      { x: this.hw, z: this.hd },
      0.4,
      this.hw + e.x - e.width / 2,
      e.width,
      e.height,
      0,
    );
  }

  /** Whether a wall opening is where a vault door stands. */
  private isVaultDoorway(
    w: { from: { x: number; z: number }; to: { x: number; z: number } },
    o: { at: number; width: number },
    storey: number,
  ): boolean {
    const alongX = w.from.z === w.to.z;
    const dir = (alongX ? Math.sign(w.to.x - w.from.x) : Math.sign(w.to.z - w.from.z)) || 1;
    const mid = (alongX ? w.from.x : w.from.z) + dir * (o.at + o.width / 2);
    return (this.layout.vaults ?? []).some(
      (v) =>
        v.storey === storey &&
        Math.abs((alongX ? v.door.x : v.door.z) - mid) < 0.5 &&
        Math.abs((alongX ? v.door.z : v.door.x) - (alongX ? w.from.z : w.from.x)) < 0.5,
    );
  }

  private surround(
    from: { x: number; z: number },
    to: { x: number; z: number },
    thickness: number,
    at: number,
    width: number,
    height: number,
    storey: number,
  ): void {
    const alongX = from.z === to.z;
    const dir = (alongX ? Math.sign(to.x - from.x) : Math.sign(to.z - from.z)) || 1;
    const start = alongX ? from.x : from.z;
    const fixed = alongX ? from.z : from.x;
    const floorY = storey * this.h;
    const pieces: [number, number, number, number][] = [
      // [along from, along to, y from, y to]
      [at - ARCHITRAVE, at, 0, height + ARCHITRAVE],
      [at + width, at + width + ARCHITRAVE, 0, height + ARCHITRAVE],
      [at - ARCHITRAVE, at + width + ARCHITRAVE, height, height + ARCHITRAVE],
    ];
    for (const side of [-1, 1])
      for (const [a, b, y0, y1] of pieces) {
        const u0 = start + dir * a;
        const u1 = start + dir * b;
        const face = fixed + side * (thickness / 2);
        const w0 = side > 0 ? face : face - ARCHITRAVE_DEPTH;
        const w1 = side > 0 ? face + ARCHITRAVE_DEPTH : face;
        const box: Aabb = alongX
          ? {
              minX: this.site.x + Math.min(u0, u1),
              maxX: this.site.x + Math.max(u0, u1),
              minZ: this.site.z + w0,
              maxZ: this.site.z + w1,
              minY: floorY + y0,
              maxY: floorY + Math.min(y1, this.h - 0.02),
            }
          : {
              minX: this.site.x + w0,
              maxX: this.site.x + w1,
              minZ: this.site.z + Math.min(u0, u1),
              maxZ: this.site.z + Math.max(u0, u1),
              minY: floorY + y0,
              maxY: floorY + Math.min(y1, this.h - 0.02),
            };
        this.box(box, (f) => (f.n[1] < 0 ? undefined : 'trim'));
      }
  }
}

/** Dresses every bank on the map (those with a layout). */
export function buildBankShells(
  map: GameMap,
  materials: BankMaterials,
  layouts: ReadonlyMap<number, BankLayout> = BANK_LAYOUTS,
): Group {
  const root = new Group();
  root.name = 'bank-shells';
  for (const site of map.banks ?? []) {
    const layout = layouts.get(site.tier);
    if (layout) root.add(new BankShellBuilder(layout, site).build(materials));
  }
  return root;
}

/** Whether a map box belongs to a dressed bank (the plain map renderer leaves those out). */
export function insideDressedBank(
  map: GameMap,
  layouts: ReadonlyMap<number, BankLayout> = BANK_LAYOUTS,
): (b: MapBox) => boolean {
  const rects = (map.banks ?? []).flatMap((s) => {
    const l = layouts.get(s.tier);
    // Exterior walls and the roof overhang the footprint by half their thickness.
    const m = 0.25;
    return l
      ? [
          {
            minX: s.x - l.width / 2 - m,
            maxX: s.x + l.width / 2 + m,
            minZ: s.z - l.depth / 2 - m,
            maxZ: s.z + l.depth / 2 + m,
          },
        ]
      : [];
  });
  return (b) =>
    b.kind !== 'furniture' &&
    rects.some((r) => b.minX >= r.minX && b.maxX <= r.maxX && b.minZ >= r.minZ && b.maxZ <= r.maxZ);
}
