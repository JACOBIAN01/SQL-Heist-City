import type { BankLayout } from './BankLayout';

/**
 * Bank 2 "Harbor Trust": a 26 × 22 m, four-storey tier-2 bank. One storey
 * taller than Bank 1, so the climb to the vault is longer and more exposed.
 * Different from Bank 1 inside: a split teller counter with two stone
 * pillars in the lobby (cover for a fight at the door), offices behind a
 * partition on the middle floors, and the vault on the top storey's
 * back-right, its door facing the open floor. Front (street side) is +z.
 */
export const BANK_2: BankLayout = {
  id: 'bank-2',
  name: 'Harbor Trust',
  tier: 2,
  width: 26,
  depth: 22,
  storeys: 4,
  storeyHeight: 3,
  entrance: { x: 0, width: 3, height: 2.6 },
  // A switchback in the back-left corner, in two 2 m lanes: lane A (x ≈ -11) climbs toward the
  // back wall onto a landing (storeys 0 → 1 and 2 → 3); lane B (x ≈ -8.5) starts a metre off the
  // back wall and climbs forward (storey 1 → 2).
  stairs: [
    { storey: 0, x: -11, z: -6.4, width: 2, heading: '-z', steps: 12, tread: 0.4 },
    { storey: 1, x: -8.5, z: -7.4, width: 2, heading: '+z', steps: 12, tread: 0.4 },
    { storey: 2, x: -11, z: -6.4, width: 2, heading: '-z', steps: 12, tread: 0.4 },
  ],
  // A lift on every storey at the front-right; F rides to the next storey up (top → ground).
  anchors: [0, 1, 2, 3].map((storey) => ({
    id: `lift:${storey}`,
    kind: 'elevator' as const,
    storey,
    x: 11,
    z: 7,
  })),
  // The vault: back-right room of the top storey. Its west wall (x = 3) has a 2.4 m doorway
  // (z -8 … -5.6) that the door fills until the last lock opens.
  vaults: [
    {
      id: 'vault',
      storey: 3,
      door: { x: 3, z: -6.8, width: 0.3, depth: 2.4, height: 2.4 },
      console: { x: 1.4, z: -6.8 },
      loot: [
        { x: 6, z: -9.5 },
        { x: 8.5, z: -9.5 },
        { x: 11, z: -9.5 },
        { x: 6, z: -3 },
        { x: 8.5, z: -3 },
        { x: 11, z: -3 },
      ],
    },
  ],
  floors: [
    {
      // Ground: the lobby. A teller counter split by a staff gap, two pillars inside the door.
      walls: [],
      blocks: [
        { x: -3.5, z: -1, width: 5, depth: 1, height: 1.1 },
        { x: 3.5, z: -1, width: 5, depth: 1, height: 1.1 },
        { x: -4, z: 5, width: 0.8, depth: 0.8, height: 2.6 },
        { x: 4, z: 5, width: 0.8, depth: 0.8, height: 2.6 },
      ],
    },
    offices(),
    offices(),
    {
      // Top: the vault room and a few desks on the open floor in front of it.
      walls: [
        {
          from: { x: 3, z: -11 },
          to: { x: 3, z: -1 },
          openings: [{ at: 3, width: 2.4, height: 2.4 }],
        },
        { from: { x: 3, z: -1 }, to: { x: 13, z: -1 } },
      ],
      blocks: [
        { x: -2, z: 4, width: 2, depth: 1, height: 0.8 },
        { x: 4, z: 4, width: 2, depth: 1, height: 0.8 },
      ],
    },
  ],
};

/** A middle storey: front offices behind a partition with two doors, the back left open for the stairs. */
function offices() {
  return {
    walls: [
      {
        from: { x: -4, z: 2 },
        to: { x: 13, z: 2 },
        openings: [
          { at: 3, width: 2, height: 2.4 },
          { at: 11, width: 2, height: 2.4 },
        ],
      },
    ],
    blocks: [
      { x: 2, z: 6, width: 2, depth: 1, height: 0.8 },
      { x: 6, z: 9, width: 2, depth: 1, height: 0.8 },
    ],
  };
}
