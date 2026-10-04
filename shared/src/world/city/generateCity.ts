import type { CitySettings } from '../../config/city';
import { SeededRng, type Rng } from '../../random/Rng';
import type { SpawnPoint } from '../map';
import type {
  BankSite,
  CityBlock,
  CityBuilding,
  CityLayout,
  HospitalSite,
  Lot,
  LotUse,
  Rect,
  SafehouseSite,
} from './CityLayout';

/** Width × depth a bank of a tier needs; the generator leaves room for it. */
export type BankFootprint = (tier: number) => { readonly width: number; readonly depth: number };

/** Open ground in front of the hospital, where the beds (respawn points) are. */
const FORECOURT = 8;
/** Spawns stand this far either side of a street's centre line: one per lane. */
const LANE_OFFSET = 3;
/** Shortest building when a lot is split into two side by side. */
const MIN_BUILDING = 10;

/** Yaw that faces along (dx, dz): forward is (−sin yaw, −cos yaw). */
const facing = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

const centre = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

/** What one block needs from its front lot. */
type Special =
  | { readonly kind: 'bank'; readonly site: Omit<BankSite, 'x' | 'z'> }
  | { readonly kind: 'safehouse'; readonly id: string }
  | { readonly kind: 'hospital' };

/**
 * Generates the city from its settings. Pure and deterministic: the same
 * settings (seed included) always give the same layout, so the server and
 * every client build identical streets and colliders without sending them.
 * Pattern: Builder (with a seeded random stream) — Why: one recipe produces
 * a whole, consistent city; tests can sweep seeds and sizes for invariants.
 */
export function generateCity(settings: CitySettings, bankFootprint: BankFootprint): CityLayout {
  const s = settings;
  const rng = new SeededRng(`city:${s.seed}`);
  const n = s.blocks;
  const halfSize = (n * s.blockPitch + s.streetWidth) / 2;
  const lines = Array.from(
    { length: n + 1 },
    (_, k) => -halfSize + s.streetWidth / 2 + k * s.blockPitch,
  );

  const cells: { ix: number; iz: number; outer: Rect; inner: Rect }[] = [];
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const outer = {
        minX: (lines[ix] ?? 0) + s.streetWidth / 2,
        maxX: (lines[ix + 1] ?? 0) - s.streetWidth / 2,
        minZ: (lines[iz] ?? 0) + s.streetWidth / 2,
        maxZ: (lines[iz + 1] ?? 0) - s.streetWidth / 2,
      };
      cells.push({ ix, iz, outer, inner: shrink(outer, s.sidewalkWidth) });
    }

  const specials = assignSites(cells, s, rng, bankFootprint);
  const banks: BankSite[] = [];
  const safehouses: SafehouseSite[] = [];
  let hospital: HospitalSite | undefined;
  const maxDistance = Math.hypot(halfSize, halfSize);

  const blocks: CityBlock[] = cells.map((cell, index) => {
    const special = specials.get(index);
    const blockRng = rng.fork(`block:${cell.ix},${cell.iz}`);
    // Taller towers downtown, low-rise on the outskirts.
    const c = centre(cell.inner);
    const centrality = 1 - Math.hypot(c.x, c.z) / maxDistance;
    const lots = quadrants(cell.inner, s, blockRng, special).map(({ rect, front }): Lot => {
      if (front && special?.kind === 'bank') {
        const { width, depth } = special.site;
        const x = clamp(Math.round(centre(rect).x), rect.minX + width / 2, rect.maxX - width / 2);
        banks.push({ ...special.site, x, z: rect.maxZ - depth / 2 });
        return { rect, use: 'bank', buildings: [] };
      }
      if (front && special?.kind === 'safehouse') {
        safehouses.push({ id: special.id, x: Math.round(centre(rect).x), z: rect.maxZ - 5 });
        return { rect, use: 'safehouse', buildings: [] };
      }
      if (front && special?.kind === 'hospital') {
        const building = { ...rect, maxZ: rect.maxZ - FORECOURT };
        hospital = { building, beds: beds(rect, s.hospitalBeds) };
        return { rect, use: 'hospital', buildings: [{ rect: building, storeys: 3 }] };
      }
      const use: LotUse = blockRng.bool(s.plazaChance) ? 'plaza' : 'building';
      return {
        rect,
        use,
        buildings: use === 'plaza' ? [] : buildings(rect, s, blockRng, centrality),
      };
    });
    return { ix: cell.ix, iz: cell.iz, outer: cell.outer, inner: cell.inner, lots };
  });

  if (!hospital) throw new Error('city: no hospital site');
  return {
    settings,
    halfSize,
    streetLinesX: lines,
    streetLinesZ: lines,
    blocks,
    banks: banks.sort((a, b) => a.tier - b.tier),
    safehouses: safehouses.sort((a, b) => a.id.localeCompare(b.id)),
    hospital,
    spawns: streetSpawns(lines),
  };
}

/**
 * Which block gets which site. Bank tiers rise toward the centre (tier 1 on
 * the outskirts); safehouses go as far from banks and each other as
 * possible, so banking means a run; the hospital takes the most central
 * block left, so nobody respawns at the edge of the world.
 */
function assignSites(
  cells: readonly { ix: number; iz: number; inner: Rect }[],
  s: CitySettings,
  rng: Rng,
  bankFootprint: BankFootprint,
): Map<number, Special> {
  const dist = (i: number) => {
    const c = centre(cells[i]?.inner ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    return Math.hypot(c.x, c.z);
  };
  // Shuffle first so equally central blocks are ordered by the seed, not by position.
  const byCentrality = rng
    .fork('sites')
    .shuffle(cells.map((_, i) => i))
    .sort((a, b) => dist(a) - dist(b));
  const taken = new Map<number, Special>();
  const free = () => byCentrality.filter((i) => !taken.has(i));

  for (let tier = s.banks; tier >= 1; tier--) {
    const rank =
      s.banks === 1
        ? byCentrality.length - 1
        : ((s.banks - tier) / (s.banks - 1)) * (byCentrality.length - 1);
    const wanted = byCentrality[Math.round(rank)] ?? 0;
    // The nearest free block in centrality order, should two tiers round to the same rank.
    const options = free();
    const pick = options.includes(wanted)
      ? wanted
      : options.reduce((best, i) =>
          Math.abs(dist(i) - dist(wanted)) < Math.abs(dist(best) - dist(wanted)) ? i : best,
        );
    const { width, depth } = bankFootprint(tier);
    taken.set(pick, { kind: 'bank', site: { id: `bank-${tier}`, tier, width, depth } });
  }

  const gridDistance = (a: number, b: number) =>
    Math.hypot(
      (cells[a]?.ix ?? 0) - (cells[b]?.ix ?? 0),
      (cells[a]?.iz ?? 0) - (cells[b]?.iz ?? 0),
    );
  for (let k = 1; k <= s.safehouses; k++) {
    let best = -1;
    let bestScore = -1;
    for (const i of free()) {
      const score = Math.min(...[...taken.keys()].map((t) => gridDistance(i, t)));
      if (score > bestScore) [best, bestScore] = [i, score];
    }
    taken.set(best, { kind: 'safehouse', id: `safehouse-${k}` });
  }

  taken.set(free()[0] ?? 0, { kind: 'hospital' });
  return taken;
}

/**
 * Splits a block's inner area into four lots with an alley between them each
 * way. The front (+z) row is where a special site goes, so its entrance
 * faces the street; a bank also needs its column wide enough.
 */
function quadrants(
  inner: Rect,
  s: CitySettings,
  rng: Rng,
  special: Special | undefined,
): { rect: Rect; front: boolean }[] {
  const needWidth = special?.kind === 'bank' ? special.site.width : s.minLot;
  const needDepth =
    special?.kind === 'bank'
      ? special.site.depth
      : special?.kind === 'hospital'
        ? FORECOURT + MIN_BUILDING
        : s.minLot;
  const specialWest = rng.bool();
  // x: the special column (west or east) at least needWidth wide.
  const [west, east] = splitPair(
    inner.maxX - inner.minX,
    s,
    rng,
    specialWest ? needWidth : s.minLot,
    specialWest ? s.minLot : needWidth,
  );
  // z: back row first, then the front row, at least needDepth deep.
  const [back, front] = splitPair(inner.maxZ - inner.minZ, s, rng, s.minLot, needDepth);
  const xs = [
    { minX: inner.minX, maxX: inner.minX + west },
    { minX: inner.maxX - east, maxX: inner.maxX },
  ];
  const zs = [
    { minZ: inner.minZ, maxZ: inner.minZ + back },
    { minZ: inner.maxZ - front, maxZ: inner.maxZ },
  ];
  const out: { rect: Rect; front: boolean }[] = [];
  zs.forEach((z, row) =>
    xs.forEach((x, col) =>
      out.push({
        rect: { ...x, ...z },
        front: row === 1 && special !== undefined && col === (specialWest ? 0 : 1),
      }),
    ),
  );
  return out;
}

/** Two even lengths that, with an alley between, fill `length`; each at least its minimum. */
function splitPair(
  length: number,
  s: CitySettings,
  rng: Rng,
  minFirst: number,
  minSecond: number,
): [number, number] {
  const usable = length - s.alleyWidth;
  const lo = even(minFirst, 'up');
  const hi = even(usable - minSecond, 'down');
  if (lo > hi)
    throw new Error(`city: a ${length} m block cannot fit lots of ${minFirst} and ${minSecond} m`);
  const first = lo + 2 * rng.int(0, (hi - lo) / 2);
  return [first, usable - first];
}

/** One or two buildings filling a lot, side by side along its longer side. */
function buildings(lot: Rect, s: CitySettings, rng: Rng, centrality: number): CityBuilding[] {
  const tallest = Math.round(
    s.minStoreys + (s.maxStoreys - s.minStoreys) * Math.max(0.35, centrality),
  );
  const storeys = () => rng.int(s.minStoreys, Math.max(s.minStoreys, tallest));
  const alongX = lot.maxX - lot.minX >= lot.maxZ - lot.minZ;
  const long = alongX ? lot.maxX - lot.minX : lot.maxZ - lot.minZ;
  if (long < 2 * MIN_BUILDING || !rng.bool(0.6)) return [{ rect: lot, storeys: storeys() }];
  const cut = MIN_BUILDING + 2 * rng.int(0, (long - 2 * MIN_BUILDING) / 2);
  const [a, b]: Rect[] = alongX
    ? [
        { ...lot, maxX: lot.minX + cut },
        { ...lot, minX: lot.minX + cut },
      ]
    : [
        { ...lot, maxZ: lot.minZ + cut },
        { ...lot, minZ: lot.minZ + cut },
      ];
  return [
    { rect: a as Rect, storeys: storeys() },
    { rect: b as Rect, storeys: storeys() },
  ];
}

/** Hospital beds in rows across the forecourt, 2 m apart, facing the street (+z). */
function beds(lot: Rect, count: number): SpawnPoint[] {
  const perRow = Math.max(1, Math.floor((lot.maxX - lot.minX - 2) / 2));
  const c = centre(lot);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const col = i % perRow;
    return {
      x: c.x + (col - (inRow - 1) / 2) * 2,
      z: lot.maxZ - 2 - row * 2,
      yaw: facing(0, 1),
    };
  });
}

/**
 * Spawns along the inner streets (the outer ring looks at the city wall), at
 * a quarter, half and three quarters of every segment, one in each lane,
 * facing along the street: twelve per segment.
 */
function streetSpawns(lines: readonly number[]): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (let k = 1; k + 1 < lines.length; k++)
    for (let j = 0; j + 1 < lines.length; j++) {
      const line = lines[k] ?? 0;
      const from = lines[j] ?? 0;
      const to = lines[j + 1] ?? 0;
      for (const t of [1 / 4, 1 / 2, 3 / 4]) {
        const along = Math.round(from + (to - from) * t);
        // North–south street at x = line, then east–west street at z = line.
        out.push(
          { x: line + LANE_OFFSET, z: along, yaw: facing(0, 1) },
          { x: line - LANE_OFFSET, z: along, yaw: facing(0, -1) },
          { x: along, z: line - LANE_OFFSET, yaw: facing(1, 0) },
          { x: along, z: line + LANE_OFFSET, yaw: facing(-1, 0) },
        );
      }
    }
  return out;
}

function shrink(r: Rect, by: number): Rect {
  return { minX: r.minX + by, maxX: r.maxX - by, minZ: r.minZ + by, maxZ: r.maxZ - by };
}

function even(v: number, round: 'up' | 'down'): number {
  return round === 'up' ? Math.ceil(v / 2) * 2 : Math.floor(v / 2) * 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
