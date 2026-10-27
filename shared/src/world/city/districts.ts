/** Facade families the client can build (kept here so the layout can say which a district favours). */
export const FACADE_FAMILIES = ['brick', 'metal', 'trim'] as const;
export type FacadeFamily = (typeof FACADE_FAMILIES)[number];

/**
 * A district (Phase 30.1): a patch of the city with its own look, name and one landmark. Where it
 * lies is a spot on the city's grid (`u`, `v` run 0–1 from the north-west corner); every block
 * belongs to the nearest spot. Defaults only: the look is data, not code.
 */
export interface DistrictDef {
  readonly id: string;
  readonly name: string;
  readonly u: number;
  readonly v: number;
  /** The facade families its buildings use (one is picked per building). */
  readonly facades: readonly FacadeFamily[];
  /** Colour of its patch on the map. */
  readonly tint: number;
  /** The one building that stands taller than the rest, and what it is called. */
  readonly landmark: string;
}

export const DEFAULT_DISTRICTS: readonly DistrictDef[] = [
  {
    id: 'downtown',
    name: 'Financial District',
    u: 0.5,
    v: 0.5,
    facades: ['metal'],
    tint: 0x6f8fb5,
    landmark: 'Reserve Tower',
  },
  {
    id: 'old-town',
    name: 'Old Town',
    u: 0,
    v: 0,
    facades: ['brick'],
    tint: 0xb5835a,
    landmark: 'Clock Tower',
  },
  {
    id: 'docks',
    name: 'The Docks',
    u: 1,
    v: 0,
    facades: ['metal', 'brick'],
    tint: 0x4f9c98,
    landmark: 'Harbour Light',
  },
  {
    id: 'market',
    name: 'Market Row',
    u: 0,
    v: 1,
    facades: ['trim', 'brick'],
    tint: 0xd99a3d,
    landmark: 'Market Hall',
  },
  {
    id: 'heights',
    name: 'Campus Heights',
    u: 1,
    v: 1,
    facades: ['trim'],
    tint: 0x7fb07f,
    landmark: 'Library Spire',
  },
];

/** The district a block belongs to: the nearest spot on the city's grid (ties go to the earlier). */
export function districtOf(
  ix: number,
  iz: number,
  blocks: number,
  defs: readonly DistrictDef[] = DEFAULT_DISTRICTS,
): DistrictDef {
  const span = Math.max(1, blocks - 1);
  let best = defs[0] as DistrictDef;
  let bestD = Infinity;
  for (const d of defs) {
    const dist = Math.hypot(ix / span - d.u, iz / span - d.v);
    if (dist < bestD) [best, bestD] = [d, dist];
  }
  return best;
}
