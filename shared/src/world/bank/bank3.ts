import type { BankLayout, FurnitureSpec } from './BankLayout';
import { boardTable, deskRow, shelfWall, waitingCorner } from './dressing';

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
      fittings: {
        depositBoxes: [
          { x: -13.8, z: 5.5, width: 7, facing: '+x' },
          { x: -9, z: 9.8, width: 6, facing: '-z' },
        ],
        cashShelves: [{ x: -9, z: 1.1, width: 5, facing: '+z' }],
      },
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
      blocks: [],
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
      blocks: [],
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
      blocks: [],
    },
  ],
  ...dressing(),
};

/**
 * Tier 3: dark granite outside, a marble lobby, wood floors and panelling in
 * the offices. The vault sits above the door, so the lobby below is the grand
 * room: a marble hall with columns and chandeliers.
 */
function dressing(): Pick<BankLayout, 'cladding' | 'rooms' | 'facade' | 'fixtures' | 'furniture'> {
  const front = 9.2; // couches against the front wall
  const back = -9.8; // inner face of the back wall
  const lift = (storey: number): FurnitureSpec => ({
    piece: 'Door_Double',
    storey,
    x: 13.65,
    z: 6,
    facing: '-x',
  });
  const furniture: FurnitureSpec[] = [
    // Ground floor: columns inside the door, waiting corners either side, tellers, ledgers.
    { piece: 'Column_Round3', storey: 0, x: -9.5, z: 1.5, solid: true },
    { piece: 'Column_Round3', storey: 0, x: -2.5, z: 1.5, solid: true },
    ...waitingCorner(0, -11, front),
    ...waitingCorner(0, 2.5, front),
    { piece: 'Carpet_1', storey: 0, x: -11, z: 7.8, facing: '+x' },
    lift(0),
    { piece: 'Light_Small', storey: 0, x: 13.55, z: 6, y: 2.3 },
    ...[-9, -7.3, -5.6, -3.9, 0, 2, 4].map((x): FurnitureSpec => ({
      piece: 'Chair_2',
      storey: 0,
      x,
      z: -3.4,
    })),
    { piece: 'Light_Desk', storey: 0, x: -8.5, z: -2, y: 1.1, facing: '-z' },
    { piece: 'Light_Desk', storey: 0, x: -4.5, z: -2, y: 1.1, facing: '-z' },
    { piece: 'Light_Desk', storey: 0, x: 3, z: -2, y: 1.1, facing: '-z' },
    ...shelfWall(0, { z: back }, [-11, -9.3, -7.6, -5.9, -4.2, -2.5]),
    ...shelfWall(0, { z: back }, [-0.8], 'Bookshelf'),
    { piece: 'Table_RoundSmall', storey: 0, x: 0, z: -6, scale: 0.7, solid: true },
    { piece: 'Trashcan_Cylindric', storey: 0, x: -10.8, z: -3.3 },
    { piece: 'Light_Chandelier', storey: 0, x: -10, z: 4 },
    { piece: 'Light_Chandelier', storey: 0, x: -2, z: 4 },
    { piece: 'Light_Chandelier', storey: 0, x: 5, z: 6 },
    // Storey 1: open-plan floor, desks in two rows, files on the back wall.
    ...deskRow(1, [-9, -5, -1, 3], 5),
    ...deskRow(1, [-9, -5, -1], -5, -1),
    ...waitingCorner(1, 5.5, front),
    ...shelfWall(1, { z: back }, [-11, -9.3, -7.6, -5.9, -4.2, -2.5]),
    lift(1),
    // Storey 2: front offices behind a wall of doors, a records corner at the back.
    ...deskRow(2, [-10, -4, 3], 6.5),
    ...shelfWall(2, { z: back }, [-11, -9.3, -7.6, -5.9, -4.2, -2.5]),
    ...waitingCorner(2, 0, -8.6, '+z'),
    { piece: 'Houseplant_6', storey: 2, x: 12.8, z: 8.8, scale: 1.5 },
    lift(2),
    // Storey 3: the executive floor: boardroom, a desk, a wall of books.
    ...boardTable(3, 4, 3, 1.5, 6),
    ...deskRow(3, [0], -5, -1),
    ...shelfWall(3, { z: back }, [-11, -9.3, -7.6, -5.9], 'Bookshelf'),
    { piece: 'Houseplant_6', storey: 3, x: 12.8, z: 8.8, scale: 1.5 },
    lift(3),
  ];
  return {
    cladding: 'granite',
    rooms: [
      { storey: 0, x: 0, z: -6, width: 28, depth: 8, floor: 'wood', walls: 'panel' },
      { storey: 1, x: 0, z: 0, width: 28, depth: 20, floor: 'wood', walls: 'panel' },
      { storey: 2, x: -4, z: 5, width: 20, depth: 10, floor: 'carpet', walls: 'panel' },
      { storey: 3, x: 0, z: 0, width: 28, depth: 20, floor: 'wood', walls: 'panel' },
      { storey: 3, x: -9, z: 5.5, width: 10, depth: 9, floor: 'steel', walls: 'steel' },
    ],
    facade: {
      pilasters: [-12.5, -10.3, -1.5, 1.5, 4.5, 11.5],
      lamps: [-8.7, -3.3],
      atm: 8,
      sign: true,
    },
    fixtures: [
      { kind: 'tellerScreen', storey: 0, x: -6.5, z: -2, width: 7, facing: '+z' },
      { kind: 'tellerScreen', storey: 0, x: 2, z: -2, width: 6, facing: '+z' },
      { kind: 'queuePosts', storey: 0, x: -6, z: 0.5, width: 6, facing: '+z' },
    ],
    furniture,
  };
}
