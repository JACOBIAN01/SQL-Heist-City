import { box, type MapAnchor, type MapBox, type MapBoxKind } from '../map';
import {
  DEFAULT_ANCHOR_RADIUS,
  DEFAULT_WALL_THICKNESS,
  EXTERIOR_THICKNESS,
  MAX_STEP_RISE,
  ROOF_THICKNESS,
  SLAB_THICKNESS,
  type BankLayout,
  type Opening,
  type Point2,
  type StairSpec,
  type WallSpec,
} from './BankLayout';

const EPS = 1e-6;

/** Throws a readable error for a layout that could not be built or walked. */
export function validateBank(layout: BankLayout): void {
  const fail = (what: string): never => {
    throw new Error(`bank ${layout.id}: ${what}`);
  };
  if (layout.width % 2 !== 0 || layout.depth % 2 !== 0) fail('footprint must be multiples of 2 m');
  if (layout.storeys < 1) fail('needs at least one storey');
  if (layout.floors.length > layout.storeys) fail('more floor plans than storeys');
  const { entrance } = layout;
  if (entrance.height >= layout.storeyHeight) fail('entrance must be lower than the storey');
  if (Math.abs(entrance.x) + entrance.width / 2 > layout.width / 2)
    fail('entrance lies outside the facade');
  const hw = layout.width / 2;
  const hd = layout.depth / 2;
  for (const st of layout.stairs ?? []) {
    const where = `stairs at (${st.x},${st.z})`;
    if (st.storey < 0 || st.storey + 1 >= layout.storeys) fail(`${where} has no storey above`);
    if (layout.storeyHeight / st.steps > MAX_STEP_RISE) fail(`${where} has steps too tall to walk`);
    const f = stairFootprint(st);
    if (f.minX < -hw || f.maxX > hw || f.minZ < -hd || f.maxZ > hd)
      fail(`${where} leaves the footprint`);
  }
  const seen = new Set<string>();
  for (const a of layout.anchors ?? []) {
    if (seen.has(a.id)) fail(`duplicate anchor ${a.id}`);
    seen.add(a.id);
    if (a.storey < 0 || a.storey >= layout.storeys) fail(`anchor ${a.id} is on a missing storey`);
    if (Math.abs(a.x) > hw || Math.abs(a.z) > hd) fail(`anchor ${a.id} leaves the footprint`);
  }
  layout.floors.forEach((plan, storey) => {
    for (const wall of plan.walls) {
      const where = `storey ${storey} wall (${wall.from.x},${wall.from.z})→(${wall.to.x},${wall.to.z})`;
      if (wall.from.x !== wall.to.x && wall.from.z !== wall.to.z)
        fail(`${where} is not axis-aligned`);
      for (const p of [wall.from, wall.to])
        if (Math.abs(p.x) > hw || Math.abs(p.z) > hd) fail(`${where} leaves the footprint`);
      const length = wallLength(wall);
      let end = 0;
      for (const o of [...(wall.openings ?? [])].sort((a, b) => a.at - b.at)) {
        if (o.at < end - EPS) fail(`${where} has overlapping openings`);
        if (o.at + o.width > length + EPS) fail(`${where} has an opening past its end`);
        if ((o.sill ?? 0) + o.height > layout.storeyHeight) fail(`${where} opening too tall`);
        end = o.at + o.width;
      }
    }
    for (const b of plan.blocks)
      if (Math.abs(b.x) + b.width / 2 > hw || Math.abs(b.z) + b.depth / 2 > hd)
        fail(`storey ${storey} block at (${b.x},${b.z}) leaves the footprint`);
  });
}

/** Floor-plan rectangle covered by a flight. */
export function stairFootprint(s: StairSpec): Rect {
  const along = s.steps * s.tread;
  const alongX = s.heading === '+x' || s.heading === '-x';
  const sx = alongX ? along : s.width;
  const sz = alongX ? s.width : along;
  return { minX: s.x - sx / 2, maxX: s.x + sx / 2, minZ: s.z - sz / 2, maxZ: s.z + sz / 2 };
}

interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Steps of one flight: solid from the storey floor up, each one `rise` higher than the last. */
function stairBoxes(layout: BankLayout, s: StairSpec, at: Point2): MapBox[] {
  const rise = layout.storeyHeight / s.steps;
  const f = stairFootprint(s);
  const out: MapBox[] = [];
  for (let i = 0; i < s.steps; i++) {
    const h = rise * (i + 1);
    const a = i * s.tread;
    const b = a + s.tread;
    const r: Rect =
      s.heading === '+x'
        ? { ...f, minX: f.minX + a, maxX: f.minX + b }
        : s.heading === '-x'
          ? { ...f, minX: f.maxX - b, maxX: f.maxX - a }
          : s.heading === '+z'
            ? { ...f, minZ: f.minZ + a, maxZ: f.minZ + b }
            : { ...f, minZ: f.maxZ - b, maxZ: f.maxZ - a };
    out.push({
      kind: 'step',
      minX: at.x + r.minX,
      maxX: at.x + r.maxX,
      minZ: at.z + r.minZ,
      maxZ: at.z + r.maxZ,
      minY: s.storey * layout.storeyHeight,
      maxY: s.storey * layout.storeyHeight + h,
    });
  }
  return out;
}

/** A floor slab covering the footprint except the holes; cut into strips so no box spans a hole. */
function slabBoxes(layout: BankLayout, top: number, holes: readonly Rect[], at: Point2): MapBox[] {
  const hw = layout.width / 2;
  const hd = layout.depth / 2;
  const xs = [-hw, hw, ...holes.flatMap((h) => [h.minX, h.maxX])]
    .filter((x) => x >= -hw && x <= hw)
    .sort((a, b) => a - b);
  const out: MapBox[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] as number;
    const x1 = xs[i + 1] as number;
    if (x1 - x0 < EPS) continue;
    const mid = (x0 + x1) / 2;
    // Holes crossing this strip, in z order; the slab fills what is between them.
    const cuts = holes.filter((h) => h.minX < mid && h.maxX > mid).sort((a, b) => a.minZ - b.minZ);
    let z = -hd;
    const fill = (z0: number, z1: number): void => {
      if (z1 - z0 < EPS) return;
      out.push({
        kind: 'interior',
        minX: at.x + x0,
        maxX: at.x + x1,
        minZ: at.z + z0,
        maxZ: at.z + z1,
        minY: top - SLAB_THICKNESS,
        maxY: top,
      });
    };
    for (const c of cuts) {
      fill(z, c.minZ);
      z = c.maxZ;
    }
    fill(z, hd);
  }
  return out;
}

const wallLength = (w: WallSpec): number =>
  Math.abs(w.to.x - w.from.x) + Math.abs(w.to.z - w.from.z);

/**
 * Turns one wall into solid boxes around its openings: the runs between
 * them, a lintel above each, and a sill block below raised openings.
 */
function wallBoxes(
  kind: MapBoxKind,
  from: Point2,
  to: Point2,
  thickness: number,
  openings: readonly Opening[],
  bottom: number,
  height: number,
  offset: Point2,
): MapBox[] {
  const alongX = from.z === to.z;
  const length = Math.abs(alongX ? to.x - from.x : to.z - from.z);
  const dir = (alongX ? Math.sign(to.x - from.x) : Math.sign(to.z - from.z)) || 1;
  const startU = alongX ? from.x : from.z;
  const fixed = alongX ? from.z : from.x;
  // A piece covering [a, b) along the wall, between two heights.
  const piece = (a: number, b: number, lo: number, hi: number): MapBox[] => {
    if (b - a < EPS || hi - lo < EPS) return [];
    const mid = startU + dir * ((a + b) / 2);
    const size = b - a;
    return alongX
      ? [box(kind, offset.x + mid, offset.z + fixed, size, hi - lo, thickness, bottom + lo)]
      : [box(kind, offset.x + fixed, offset.z + mid, thickness, hi - lo, size, bottom + lo)];
  };
  const out: MapBox[] = [];
  let cursor = 0;
  for (const o of [...openings].sort((a, b) => a.at - b.at)) {
    out.push(...piece(cursor, o.at, 0, height));
    out.push(...piece(o.at, o.at + o.width, 0, o.sill ?? 0));
    out.push(...piece(o.at, o.at + o.width, (o.sill ?? 0) + o.height, height));
    cursor = o.at + o.width;
  }
  out.push(...piece(cursor, length, 0, height));
  return out;
}

/** The bank's usable spots in world coordinates. */
export function compileAnchors(layout: BankLayout, at: Point2): MapAnchor[] {
  return (layout.anchors ?? []).map((a) => ({
    id: `${layout.id}:${a.id}`,
    kind: a.kind,
    x: at.x + a.x,
    y: a.storey * layout.storeyHeight,
    z: at.z + a.z,
    radius: a.radius ?? DEFAULT_ANCHOR_RADIUS,
    bank: layout.id,
    storey: a.storey,
  }));
}

/**
 * Compiles a bank into collider boxes placed at `at` on the ground.
 * Pattern: Builder — a declarative layout in, the geometry the simulation
 * needs out. Why: server and client run this same function, so they cannot
 * disagree about where a wall is, and new banks are data, not code.
 */
export function compileBank(layout: BankLayout, at: Point2): MapBox[] {
  validateBank(layout);
  const hw = layout.width / 2;
  const hd = layout.depth / 2;
  const total = layout.storeys * layout.storeyHeight;
  const boxes: MapBox[] = [];

  // Shell, once per storey so the street door only cuts the ground floor.
  for (let s = 0; s < layout.storeys; s++) {
    const bottom = s * layout.storeyHeight;
    const h = layout.storeyHeight;
    const e = EXTERIOR_THICKNESS;
    const door: Opening[] =
      s === 0
        ? [
            {
              at: hw + layout.entrance.x - layout.entrance.width / 2,
              width: layout.entrance.width,
              height: layout.entrance.height,
            },
          ]
        : [];
    // Front runs west→east so openings measure from the west corner.
    boxes.push(
      ...wallBoxes('building', { x: -hw, z: hd }, { x: hw, z: hd }, e, door, bottom, h, at),
      ...wallBoxes('building', { x: -hw, z: -hd }, { x: hw, z: -hd }, e, [], bottom, h, at),
      ...wallBoxes('building', { x: -hw, z: -hd }, { x: -hw, z: hd }, e, [], bottom, h, at),
      ...wallBoxes('building', { x: hw, z: -hd }, { x: hw, z: hd }, e, [], bottom, h, at),
    );
  }
  boxes.push(
    box(
      'building',
      at.x,
      at.z,
      layout.width + EXTERIOR_THICKNESS,
      ROOF_THICKNESS,
      layout.depth + EXTERIOR_THICKNESS,
      total,
    ),
  );

  const stairs = layout.stairs ?? [];
  for (let s = 1; s < layout.storeys; s++) {
    const holes = stairs.filter((st) => st.storey === s - 1).map(stairFootprint);
    boxes.push(...slabBoxes(layout, s * layout.storeyHeight, holes, at));
  }
  for (const st of stairs) boxes.push(...stairBoxes(layout, st, at));

  layout.floors.forEach((plan, s) => {
    const bottom = s * layout.storeyHeight;
    for (const w of plan.walls)
      boxes.push(
        ...wallBoxes(
          'interior',
          w.from,
          w.to,
          w.thickness ?? DEFAULT_WALL_THICKNESS,
          w.openings ?? [],
          bottom,
          layout.storeyHeight,
          at,
        ),
      );
    for (const b of plan.blocks)
      boxes.push(
        box(
          b.kind ?? 'cover',
          at.x + b.x,
          at.z + b.z,
          b.width,
          b.height,
          b.depth,
          bottom + (b.bottom ?? 0),
        ),
      );
  });
  return boxes;
}
