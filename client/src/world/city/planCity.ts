import {
  CLOSED_BANK_STOREYS,
  EXTERIOR_THICKNESS,
  KERB_HEIGHT,
  SeededRng,
  type BankLayout,
  type CityBlock,
  type CityLayout,
  type Rect,
  type Rng,
} from '@heist/shared';
import {
  CORNICE_HEIGHT,
  FACADE_STYLES,
  placeFacade,
  STYLE_IDS,
  type FacadeBuilding,
  type FacadeSide,
} from './facades';
import {
  subtractRects,
  type ChunkPlan,
  type GroundQuad,
  type Caster,
  type Mass,
  type Placement,
  type Turn,
  type WallQuad,
} from './plan';

/** Kit street pieces sit with the asphalt at y = −0.15; the game's street is y = 0. */
const KIT_GROUND = 0.15;
/** Road markings float this far above the asphalt (with polygon offset) so they never flicker. */
const DECAL_LIFT = 0.02;
const CROSSWALK = 'Decal_Crosswalk_Wide';
const CROSSWALK_DEPTH = 4.67;
const CENTRE_LINE = 'Decal_DoubleYellow_Straight';
const CENTRE_LINE_LENGTH = 6;

/** Ground textures: layer and metres per repeat. */
const ASPHALT = { layer: 'asphalt', tile: 6 };
const PAVING = { layer: 'concrete', tile: 3 };
const PLAZA = { layer: 'marble', tile: 4 };
const ROOF = { layer: 'asphalt', tile: 4 };

interface ArtBuilding {
  readonly rect: Rect;
  readonly storeys: number;
  /** Bank 1 and the like: a real interior whose collider walls stick out of the footprint. */
  readonly outset?: number;
  readonly door?: { readonly from: number; readonly to: number };
  readonly style?: keyof typeof FACADE_STYLES;
  /** False when something else draws the roof (a bank's collider roof slab). */
  readonly roof: boolean;
}

/**
 * Plans the art of the whole city, one chunk per block. Seeded from the city
 * seed, so every client draws the same facades. Art only: nothing here
 * affects collisions, which come from the same layout through compileCity.
 */
export function planCity(
  city: CityLayout,
  bankLayouts: ReadonlyMap<number, BankLayout>,
): ChunkPlan[] {
  const rng = new SeededRng(`city-art:${city.settings.seed}`);
  return city.blocks.map((block) =>
    planChunk(city, block, bankLayouts, rng.fork(`${block.ix},${block.iz}`)),
  );
}

export function planChunk(
  city: CityLayout,
  block: CityBlock,
  bankLayouts: ReadonlyMap<number, BankLayout>,
  rng: Rng,
): ChunkPlan {
  const s = city.settings;
  const n = s.blocks;
  const lines = city.streetLinesX;
  const half = s.streetWidth / 2;
  // This chunk's ground: from the street west/north of the block up to the next one (the last also owns the outer ring).
  const bounds: Rect = {
    minX: (lines[block.ix] ?? 0) - half,
    maxX: (lines[block.ix + 1] ?? 0) - half + (block.ix === n - 1 ? s.streetWidth : 0),
    minZ: (lines[block.iz] ?? 0) - half,
    maxZ: (lines[block.iz + 1] ?? 0) - half + (block.iz === n - 1 ? s.streetWidth : 0),
  };
  const placements: Placement[] = [];
  const ground: GroundQuad[] = [];
  const walls: WallQuad[] = [];
  const masses: Mass[] = [];
  const casters: Caster[] = [];

  // Asphalt around the block, the sidewalk ring (top and kerb faces), paving or plaza inside.
  for (const r of subtractRects(bounds, [block.outer])) ground.push({ rect: r, y: 0, ...ASPHALT });
  for (const r of subtractRects(block.outer, [block.inner]))
    ground.push({ rect: r, y: KERB_HEIGHT, ...PAVING });
  walls.push(...ringFaces(block.outer, 'out'), ...ringFaces(block.inner, 'in'));
  const lots = block.lots.map((l) => l.rect);
  for (const r of subtractRects(block.inner, lots)) ground.push({ rect: r, y: 0, ...PAVING });
  for (const lot of block.lots)
    ground.push({
      rect: lot.rect,
      y: 0,
      ...(lot.use === 'plaza' || lot.use === 'safehouse' ? PLAZA : PAVING),
    });

  placements.push(...roadMarkings(city, block, bounds));

  // Buildings: the lots' shells, plus banks standing on this block.
  const buildings: ArtBuilding[] = block.lots.flatMap((l) =>
    l.buildings.map((b) => ({ ...b, roof: true })),
  );
  for (const site of city.banks) {
    if (!(
      site.x > block.inner.minX &&
      site.x < block.inner.maxX &&
      site.z > block.inner.minZ &&
      site.z < block.inner.maxZ
    ))
      continue;
    const rect = {
      minX: site.x - site.width / 2,
      maxX: site.x + site.width / 2,
      minZ: site.z - site.depth / 2,
      maxZ: site.z + site.depth / 2,
    };
    const layout = bankLayouts.get(site.tier);
    buildings.push(
      layout
        ? {
            rect,
            storeys: layout.storeys,
            outset: EXTERIOR_THICKNESS / 2 + 0.02,
            door: {
              from: site.width / 2 + layout.entrance.x - layout.entrance.width / 2,
              to: site.width / 2 + layout.entrance.x + layout.entrance.width / 2,
            },
            style: 'trim',
            roof: false,
          }
        : { rect, storeys: CLOSED_BANK_STOREYS, style: 'trim', roof: true },
    );
  }

  for (const b of buildings) {
    const style = FACADE_STYLES[b.style ?? (rng.pick(STYLE_IDS) as keyof typeof FACADE_STYLES)];
    const facade: FacadeBuilding = {
      rect: b.rect,
      storeys: b.storeys,
      storeyHeight: s.storeyHeight,
      style,
      ...(b.outset ? { outset: b.outset } : {}),
      sides: ([0, 1, 2, 3] as Turn[]).map((turn) => sideFor(b, turn, block, buildings)),
    };
    placements.push(...placeFacade(facade, rng));
    casters.push({ rect: b.rect, height: b.storeys * s.storeyHeight + CORNICE_HEIGHT });
    if (b.roof) {
      const top = b.storeys * s.storeyHeight;
      ground.push({ rect: b.rect, y: top, ...ROOF });
      placements.push(...roofClutter(b.rect, top, rng));
      // A bank with a real interior keeps its collider boxes on screen, so it needs no mass.
      masses.push({ rect: b.rect, height: top, layer: style.massLayer });
    }
  }

  // A few planters on plazas, keeping the middle clear.
  for (const lot of block.lots.filter((l) => l.use === 'plaza'))
    for (const corner of corners(lot.rect, 2.5))
      if (rng.bool(0.6))
        placements.push({ piece: 'Prop_Planter_Single', ...corner, y: 0, turn: 0 });

  return {
    id: `chunk-${block.ix}-${block.iz}`,
    bounds,
    placements,
    ground,
    walls,
    masses,
    casters,
  };
}

/** How deep the ring of buildings outside the city wall is, m. */
export const OUTSKIRTS_DEPTH = 20;

/**
 * A ring of buildings just outside the city wall, facing in, so the edge of
 * the map looks like more city instead of a bare wall. Art only: the wall
 * collider stays where it is. One chunk per 64 m stretch of each side.
 */
export function planOutskirts(city: CityLayout): ChunkPlan[] {
  const rng = new SeededRng(`city-outskirts:${city.settings.seed}`);
  const s = city.settings;
  const h = city.halfSize;
  const d = OUTSKIRTS_DEPTH;
  const plans: ChunkPlan[] = [];
  // Each side: the turn its buildings face, and how to map (along, depth) to a footprint.
  const sides: { name: string; turn: Turn; rect: (a: number, b: number, depth: number) => Rect }[] =
    [
      { name: 'n', turn: 0, rect: (a, b, k) => ({ minX: a, maxX: b, minZ: -h - k, maxZ: -h }) },
      { name: 's', turn: 2, rect: (a, b, k) => ({ minX: a, maxX: b, minZ: h, maxZ: h + k }) },
      { name: 'w', turn: 1, rect: (a, b, k) => ({ minX: -h - k, maxX: -h, minZ: a, maxZ: b }) },
      { name: 'e', turn: 3, rect: (a, b, k) => ({ minX: h, maxX: h + k, minZ: a, maxZ: b }) },
    ];
  for (const side of sides) {
    // North and south run the full width plus the corners; east and west fill in between.
    const start = side.name === 'n' || side.name === 's' ? -h - d : -h;
    const end = side.name === 'n' || side.name === 's' ? h + d : h;
    for (let from = start; from < end; from += s.blockPitch) {
      const to = Math.min(end, from + s.blockPitch);
      const placements: Placement[] = [];
      const ground: GroundQuad[] = [];
      const masses: Mass[] = [];
      for (let a = from; a < to;) {
        const width = Math.min(to - a, 2 * rng.int(5, 12));
        const depth = 2 * rng.int(7, d / 2);
        const storeys = rng.int(3, s.maxStoreys + 2);
        const rect = side.rect(a, a + width, depth);
        const style = FACADE_STYLES[rng.pick(STYLE_IDS)];
        placements.push(
          ...placeFacade(
            {
              rect,
              storeys,
              storeyHeight: s.storeyHeight,
              style,
              sides: [{ turn: side.turn, street: true, hiddenStoreys: 0 }],
            },
            rng,
          ),
        );
        const top = storeys * s.storeyHeight;
        ground.push({ rect, y: top, ...ROOF });
        masses.push({ rect, height: top, layer: style.massLayer });
        a += width;
      }
      plans.push({
        id: `outskirts-${side.name}-${Math.round(from)}`,
        bounds: side.rect(from, to, d),
        placements,
        ground,
        walls: [],
        masses,
        casters: masses.map(({ rect, height }) => ({ rect, height: height + CORNICE_HEIGHT })),
      });
    }
  }
  return plans;
}

/** How one side of a building is dressed: street-facing or not, and how much a neighbour hides. */
function sideFor(
  b: ArtBuilding,
  turn: Turn,
  block: CityBlock,
  all: readonly ArtBuilding[],
): FacadeSide {
  const r = b.rect;
  const i = block.inner;
  const street =
    [r.maxZ === i.maxZ, r.maxX === i.maxX, r.minZ === i.minZ, r.minX === i.minX][turn] ?? false;
  let hidden = 0;
  for (const o of all) {
    if (o === b) continue;
    const q = o.rect;
    // A neighbour flush against this side and covering all of it hides the storeys it has.
    const flush = [
      q.minZ === r.maxZ && q.minX <= r.minX && q.maxX >= r.maxX,
      q.minX === r.maxX && q.minZ <= r.minZ && q.maxZ >= r.maxZ,
      q.maxZ === r.minZ && q.minX <= r.minX && q.maxX >= r.maxX,
      q.maxX === r.minX && q.minZ <= r.minZ && q.maxZ >= r.maxZ,
    ][turn];
    if (flush) hidden = Math.max(hidden, o.storeys);
  }
  return {
    turn,
    street,
    hiddenStoreys: hidden,
    ...(turn === 0 && b.door ? { gap: b.door } : {}),
  };
}

/** Kerb faces around a rect: facing out toward the street, or in toward the lots. */
function ringFaces(r: Rect, facing: 'out' | 'in'): WallQuad[] {
  // Corner order NW → NE → SE → SW: the right-hand side of each edge (see wallNormal) is inside.
  const corners = [
    { x: r.minX, z: r.minZ },
    { x: r.maxX, z: r.minZ },
    { x: r.maxX, z: r.maxZ },
    { x: r.minX, z: r.maxZ },
  ];
  return corners.map((from, k) => {
    const to = corners[(k + 1) % 4] as { x: number; z: number };
    const [a, b] = facing === 'out' ? [to, from] : [from, to];
    return { from: a, to: b, bottom: 0, top: KERB_HEIGHT, ...PAVING };
  });
}

/** Centre lines and crosswalks on the streets this chunk owns (west and north of the block; the outer ring at the edge). */
function roadMarkings(city: CityLayout, block: CityBlock, bounds: Rect): Placement[] {
  const out: Placement[] = [];
  const o = block.outer;
  const n = city.settings.blocks;
  const lines = city.streetLinesX;
  const y = KIT_GROUND + DECAL_LIFT;
  // East–west streets (along x) at z = line; north–south ones (along z) at x = line.
  const ew = [lines[block.iz] ?? 0, ...(block.iz === n - 1 ? [lines[n] ?? 0] : [])];
  const ns = [lines[block.ix] ?? 0, ...(block.ix === n - 1 ? [lines[n] ?? 0] : [])];
  for (const z of ew) {
    out.push(...centreLine(o.minX, o.maxX, (t) => ({ x: t, z }), 0, y));
    out.push({ piece: CROSSWALK, x: o.minX + CROSSWALK_DEPTH / 2, y, z, turn: 0 });
    out.push({ piece: CROSSWALK, x: o.maxX - CROSSWALK_DEPTH / 2, y, z, turn: 0 });
  }
  for (const x of ns) {
    out.push(...centreLine(o.minZ, o.maxZ, (t) => ({ x, z: t }), 1, y));
    out.push({ piece: CROSSWALK, x, y, z: o.minZ + CROSSWALK_DEPTH / 2, turn: 1 });
    out.push({ piece: CROSSWALK, x, y, z: o.maxZ - CROSSWALK_DEPTH / 2, turn: 1 });
  }
  return out.filter(
    (p) => p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ,
  );
}

/** Double yellow pieces end to end along a segment, between its crosswalks. */
function centreLine(
  from: number,
  to: number,
  at: (t: number) => { x: number; z: number },
  turn: Turn,
  y: number,
): Placement[] {
  const room = to - from - 2 * (CROSSWALK_DEPTH + 1);
  const count = Math.max(0, Math.floor(room / CENTRE_LINE_LENGTH));
  const start = (from + to) / 2 - (count * CENTRE_LINE_LENGTH) / 2 + CENTRE_LINE_LENGTH / 2;
  return Array.from({ length: count }, (_, k) => ({
    piece: CENTRE_LINE,
    ...at(start + k * CENTRE_LINE_LENGTH),
    y,
    turn,
  }));
}

/** An air-conditioning unit or two on a roof, away from the edges. */
function roofClutter(r: Rect, top: number, rng: Rng): Placement[] {
  const count = rng.int(0, 2);
  return Array.from({ length: count }, () => ({
    piece: 'Prop_ACUnit',
    x: r.minX + 2 + rng.next() * Math.max(0, r.maxX - r.minX - 4),
    y: top,
    z: r.minZ + 2 + rng.next() * Math.max(0, r.maxZ - r.minZ - 4),
    turn: rng.int(0, 3) as Turn,
  }));
}

function corners(r: Rect, inset: number): { x: number; z: number }[] {
  return [
    { x: r.minX + inset, z: r.minZ + inset },
    { x: r.maxX - inset, z: r.minZ + inset },
    { x: r.minX + inset, z: r.maxZ - inset },
    { x: r.maxX - inset, z: r.maxZ - inset },
  ];
}
