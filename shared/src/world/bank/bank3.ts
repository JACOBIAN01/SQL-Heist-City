import type { BankLayout } from './BankLayout';

/**
 * Bank 3 "Metro Capital": a 28 × 20 m, four-storey tier-3 bank, wide and
 * shallow. Unlike Banks 1 and 2 its door is off to the left and its stairs
 * run across the building (east–west) in the back-right corner, so the
 * climb ends far from where the vault is: the vault sits at the front-left
 * of the top storey, right above the door, and reaching it means crossing
 * the whole top floor. Front (street side) is +z.
 */
export const BANK_3: BankLayout = {
  id: 'bank-3',
  name: 'Metro Capital',
  tier: 3,
  width: 28,
  depth: 20,
  storeys: 4,
  storeyHeight: 3,
  entrance: { x: -6, width: 3, height: 2.6 },
  // A switchback against the east wall, in two 2 m lanes: lane A (z ≈ -7) climbs east onto a
  // landing at the east wall (storeys 0 → 1 and 2 → 3); lane B (z ≈ -4.5) starts a metre off the
  // east wall and climbs west (storey 1 → 2).
  stairs: [
    { storey: 0, x: 9.4, z: -7, width: 2, heading: '+x', steps: 12, tread: 0.4 },
    { storey: 1, x: 10.4, z: -4.5, width: 2, heading: '-x', steps: 12, tread: 0.4 },
    { storey: 2, x: 9.4, z: -7, width: 2, heading: '+x', steps: 12, tread: 0.4 },
  ],
  // A lift on every storey at the front-right; F rides to the next storey up (top → ground).
  anchors: [0, 1, 2, 3].map((storey) => ({
    id: `lift:${storey}`,
    kind: 'elevator' as const,
    storey,
    x: 11,
    z: 6,
  })),
  // The vault: front-left room of the top storey. Its east wall (x = -4) has a 2.4 m doorway
  // (z 4 … 6.4) that the door fills until the last lock opens.
  vaults: [
    {
      id: 'vault',
      storey: 3,
      door: { x: -4, z: 5.2, width: 0.3, depth: 2.4, height: 2.4 },
      console: { x: -2.4, z: 5.2 },
      loot: [
        { x: -12, z: 3 },
        { x: -9, z: 3 },
        { x: -6, z: 3 },
        { x: -12, z: 8.5 },
        { x: -9, z: 8.5 },
        { x: -6, z: 8.5 },
      ],
    },
  ],
  floors: [
    {
      // Ground: the lobby. A long counter split by a staff gap, facing the door.
      walls: [],
      blocks: [
        { x: -6.5, z: -2, width: 7, depth: 1, height: 1.1 },
        { x: 2, z: -2, width: 6, depth: 1, height: 1.1 },
      ],
    },
    {
      // Storey 1: an open-plan floor of desks.
      walls: [],
      blocks: [-9, -5, -1, 3].flatMap((x) => [
        { x, z: 5, width: 2, depth: 1, height: 0.8 },
        ...(x < 3 ? [{ x, z: -5, width: 2, depth: 1, height: 0.8 }] : []),
      ]),
    },
    {
      // Storey 2: front offices off a wall with three doors.
      walls: [
        {
          from: { x: -14, z: 0 },
          to: { x: 6, z: 0 },
          openings: [
            { at: 3, width: 2, height: 2.4 },
            { at: 9, width: 2, height: 2.4 },
            { at: 15, width: 2, height: 2.4 },
          ],
        },
      ],
      blocks: [
        { x: -7, z: 6, width: 2, depth: 1, height: 0.8 },
        { x: 0, z: 6, width: 2, depth: 1, height: 0.8 },
      ],
    },
    {
      // Top: the vault room above the door, and a few desks on the open floor.
      walls: [
        {
          from: { x: -4, z: 1 },
          to: { x: -4, z: 10 },
          openings: [{ at: 3, width: 2.4, height: 2.4 }],
        },
        { from: { x: -14, z: 1 }, to: { x: -4, z: 1 } },
      ],
      blocks: [
        { x: 4, z: 5, width: 2, depth: 1, height: 0.8 },
        { x: 0, z: -5, width: 2, depth: 1, height: 0.8 },
      ],
    },
  ],
};
