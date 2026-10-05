import type { BankLayout, FloorPlan } from './BankLayout';

/**
 * Bank 5 "Federal Vault": the 28 × 28 m, six-storey tier-5 bank in the
 * city centre, the hardest and richest. The stairs do not run straight to
 * the top: a back-west switchback climbs to storey 3, and the rest of the
 * way is up a second switchback in the front-east corner, so every crew
 * must cross the open storey 3 diagonally. On the top floor the vault sits
 * behind an anteroom: two doorways to fight through, the console in
 * between. Front (street side) is +z.
 */
export const BANK_5: BankLayout = {
  id: 'bank-5',
  name: 'Federal Vault',
  tier: 5,
  width: 28,
  depth: 28,
  storeys: 6,
  storeyHeight: 3,
  entrance: { x: 0, width: 3, height: 2.6 },
  stairs: [
    // West core (back-west corner), storeys 0 → 3: lane A (x = -12) climbs back onto a landing
    // at the back wall; lane B (x = -9.5) starts a metre off it and climbs forward.
    { storey: 0, x: -12, z: -9.4, width: 2, heading: '-z', steps: 12, tread: 0.4 },
    { storey: 1, x: -9.5, z: -10.4, width: 2, heading: '+z', steps: 12, tread: 0.4 },
    { storey: 2, x: -12, z: -9.4, width: 2, heading: '-z', steps: 12, tread: 0.4 },
    // East core (front-east corner), storeys 3 → 5, the mirror image toward the front wall.
    { storey: 3, x: 12, z: 9.4, width: 2, heading: '+z', steps: 12, tread: 0.4 },
    { storey: 4, x: 9.5, z: 10.4, width: 2, heading: '-z', steps: 12, tread: 0.4 },
  ],
  // A lift on every storey at the back-east; F rides to the next storey up (top → ground).
  anchors: [0, 1, 2, 3, 4, 5].map((storey) => ({
    id: `lift:${storey}`,
    kind: 'elevator' as const,
    storey,
    x: 11,
    z: -10,
  })),
  // The vault: back-centre of the top storey, behind an anteroom. The anteroom's door
  // (z = 1, x -1 … 1) is always open; the vault's (z = -5, x -1.2 … 1.2) holds until the last lock.
  vaults: [
    {
      id: 'vault',
      storey: 5,
      door: { x: 0, z: -5, width: 2.4, depth: 0.3, height: 2.4 },
      console: { x: 0, z: -3.4 },
      loot: [-5.5, -2, 2, 5.5].flatMap((x) => [
        { x, z: -12 },
        { x, z: -7.5 },
      ]),
    },
  ],
  floors: [
    {
      // Ground: a long lobby, the counter split by a staff gap, pillars and a guard desk.
      walls: [],
      blocks: [
        { x: -4, z: -3, width: 6, depth: 1, height: 1.1 },
        { x: 4, z: -3, width: 6, depth: 1, height: 1.1 },
        ...[-4.5, 4.5].flatMap((x) =>
          [3, 8].map((z) => ({ x, z, width: 0.8, depth: 0.8, height: 2.6 })),
        ),
        { x: 8, z: 10, width: 2, depth: 1, height: 1 },
      ],
    },
    {
      // Storey 1: offices behind a wall with two doors.
      walls: [
        {
          from: { x: -8, z: 0 },
          to: { x: 8, z: 0 },
          openings: [
            { at: 3, width: 2, height: 2.4 },
            { at: 11, width: 2, height: 2.4 },
          ],
        },
      ],
      blocks: [desk(-4, 5), desk(4, 5)],
    },
    { walls: [], blocks: [desk(-4, 4), desk(0, 4), desk(4, 4), desk(0, -4)] },
    {
      // Storey 3: the trading floor everyone must cross, from the west stairs to the east ones.
      walls: [],
      blocks: [
        ...[-6, 0, 6].flatMap((x) => [desk(x, 2), desk(x, -4)]),
        { x: -2, z: 8, width: 3, depth: 0.6, height: 1.2, kind: 'cover' as const },
        { x: 3, z: -9, width: 3, depth: 0.6, height: 1.2, kind: 'cover' as const },
      ],
    },
    { walls: [], blocks: [desk(-5, 3), desk(0, -2), desk(4, 2)] },
    {
      // Top: anteroom (console inside) in front of the vault, both across the back-centre.
      walls: [
        { from: { x: -7, z: -14 }, to: { x: -7, z: 1 } },
        { from: { x: 7, z: -14 }, to: { x: 7, z: 1 } },
        {
          from: { x: -7, z: -5 },
          to: { x: 7, z: -5 },
          openings: [{ at: 5.8, width: 2.4, height: 2.4 }],
        },
        {
          from: { x: -7, z: 1 },
          to: { x: 7, z: 1 },
          openings: [{ at: 6, width: 2, height: 2.4 }],
        },
      ],
      blocks: [],
    },
  ],
};

function desk(x: number, z: number): FloorPlan['blocks'][number] {
  return { x, z, width: 2, depth: 1, height: 0.8 };
}
