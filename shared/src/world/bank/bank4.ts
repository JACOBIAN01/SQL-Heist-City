import type { BankLayout, StairSpec } from './BankLayout';

/**
 * Bank 4 "Grand Reserve": a 28 × 24 m, five-storey tier-4 bank. The first
 * with two ways up: a stair core in each back corner, so a crew can split
 * and a lone guard cannot hold one chokepoint. A wide door opens on a
 * pillared lobby; a records room fills the middle of storey 2; the vault
 * is at the centre-back of the top storey, its door facing the front, so
 * both cores arrive on its flanks. Front (street side) is +z.
 */
export const BANK_4: BankLayout = {
  id: 'bank-4',
  name: 'Grand Reserve',
  tier: 4,
  width: 28,
  depth: 24,
  storeys: 5,
  storeyHeight: 3,
  entrance: { x: 0, width: 4, height: 2.8 },
  // Two switchbacks, one per back corner, mirror images. Each has two 2 m lanes: lane A (by the
  // side wall) climbs toward the back wall onto a landing; lane B starts a metre off the back
  // wall and climbs forward. Storeys 0 and 2 go up lane A, storeys 1 and 3 lane B.
  stairs: [-1, 1].flatMap((side) => core(side)),
  // A lift on every storey at the front-right; F rides to the next storey up (top → ground).
  anchors: [0, 1, 2, 3, 4].map((storey) => ({
    id: `lift:${storey}`,
    kind: 'elevator' as const,
    storey,
    x: 9,
    z: 9,
  })),
  // The vault: centre-back of the top storey. Its front wall (z = -3) has a 2.4 m doorway
  // (x -1.2 … 1.2) that the door fills until the last lock opens.
  vaults: [
    {
      id: 'vault',
      storey: 4,
      door: { x: 0, z: -3, width: 2.4, depth: 0.3, height: 2.4 },
      console: { x: 0, z: -1.4 },
      loot: [
        { x: -4, z: -10 },
        { x: -1.3, z: -10 },
        { x: 1.3, z: -10 },
        { x: 4, z: -10 },
        { x: -4, z: -5 },
        { x: 4, z: -5 },
      ],
    },
  ],
  floors: [
    {
      // Ground: a pillared lobby, the counter split by a staff gap.
      walls: [],
      blocks: [
        { x: -3.75, z: -2, width: 4.5, depth: 1, height: 1.1 },
        { x: 3.75, z: -2, width: 4.5, depth: 1, height: 1.1 },
        ...[-4, 4].flatMap((x) =>
          [3, 8].map((z) => ({ x, z, width: 0.8, depth: 0.8, height: 2.6 })),
        ),
      ],
    },
    {
      // Storey 1: offices along the front behind a wall with two doors.
      walls: [
        {
          from: { x: -8, z: 4 },
          to: { x: 8, z: 4 },
          openings: [
            { at: 3, width: 2, height: 2.4 },
            { at: 11, width: 2, height: 2.4 },
          ],
        },
      ],
      blocks: [
        { x: -4, z: 8, width: 2, depth: 1, height: 0.8 },
        { x: 3, z: 8, width: 2, depth: 1, height: 0.8 },
      ],
    },
    {
      // Storey 2: a records room in the middle, one door facing the front.
      walls: [
        { from: { x: -5, z: -8 }, to: { x: 5, z: -8 } },
        { from: { x: -5, z: -8 }, to: { x: -5, z: 0 } },
        { from: { x: 5, z: -8 }, to: { x: 5, z: 0 } },
        { from: { x: -5, z: 0 }, to: { x: 5, z: 0 }, openings: [{ at: 4, width: 2, height: 2.4 }] },
      ],
      blocks: [
        { x: -3, z: -6, width: 1, depth: 3, height: 2 },
        { x: 3, z: -6, width: 1, depth: 3, height: 2 },
      ],
    },
    {
      // Storey 3: open floor with desks.
      walls: [],
      blocks: [-5, 0, 5].flatMap((x) => [
        { x, z: 2, width: 2, depth: 1, height: 0.8 },
        { x, z: 7, width: 2, depth: 1, height: 0.8 },
      ]),
    },
    {
      // Top: the vault room at the centre-back.
      walls: [
        { from: { x: -6, z: -12 }, to: { x: -6, z: -3 } },
        { from: { x: 6, z: -12 }, to: { x: 6, z: -3 } },
        {
          from: { x: -6, z: -3 },
          to: { x: 6, z: -3 },
          openings: [{ at: 4.8, width: 2.4, height: 2.4 }],
        },
      ],
      blocks: [],
    },
  ],
};

/** One corner's stairs: `side` -1 is the west core, +1 the east one. */
function core(side: number): StairSpec[] {
  const laneA = { x: side * 12, z: -7.4, heading: '-z' as const };
  const laneB = { x: side * 9.5, z: -8.4, heading: '+z' as const };
  return [0, 1, 2, 3].map((storey) => ({
    storey,
    ...(storey % 2 === 0 ? laneA : laneB),
    width: 2,
    steps: 12,
    tread: 0.4,
  }));
}
