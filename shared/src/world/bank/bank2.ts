import type { BankLayout, FloorPlan, FurnitureSpec } from './BankLayout';
import { boardTable, deskRow, shelfWall, waitingCorner } from './dressing';

/**
 * Bank 2 "City Trust": a 26 × 22 m, four-storey tier-2 bank. One storey
 * taller than Bank 1, so the climb to the vault is longer and more exposed.
 * Different from Bank 1 inside: a split teller counter with two stone
 * pillars in the lobby (cover for a fight at the door), offices behind a
 * partition on the middle floors, and the vault on the top storey's
 * back-right, its door facing the open floor. Front (street side) is +z.
 */
export const BANK_2: BankLayout = {
  id: 'bank-2',
  name: 'City Trust',
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
      fittings: {
        depositBoxes: [
          { x: 8.5, z: -10.8, width: 7, facing: '+z' },
          { x: 12.8, z: -6, width: 6, facing: '-x' },
        ],
        cashShelves: [{ x: 8, z: -1.1, width: 6, facing: '-z' }],
      },
    },
  ],
  floors: [
    {
      // Ground: the lobby. A teller counter split by a staff gap, two pillars inside the door.
      walls: [],
      blocks: [
        { x: -3.5, z: -1, width: 5, depth: 1, height: 1.1 },
        { x: 3.5, z: -1, width: 5, depth: 1, height: 1.1 },
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
      blocks: [],
    },
  ],
  ...dressing(),
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
    blocks: [],
  } satisfies FloorPlan;
}

/**
 * Tier 2 looks modest and clean: sandstone outside, a tiled lobby, wood and
 * panelling behind the counter, plain carpeted floors above, the executive
 * floor in wood. (Pillars and desks are furniture, not blocks.)
 */
function dressing(): Pick<BankLayout, 'cladding' | 'rooms' | 'facade' | 'fixtures' | 'furniture'> {
  const front = 10.2; // couches against the front wall
  const back = -10.8; // inner face of the back wall
  const furniture: FurnitureSpec[] = [
    // Ground floor: pillars, a waiting corner each side, tellers, ledgers on the back wall.
    { piece: 'Column_Round3', storey: 0, x: -4, z: 5, solid: true },
    { piece: 'Column_Round3', storey: 0, x: 4, z: 5, solid: true },
    ...waitingCorner(0, -7.5, front),
    ...waitingCorner(0, 7.5, front),
    { piece: 'Carpet_1', storey: 0, x: -7.5, z: 8.9, facing: '+x' },
    { piece: 'Door_Double', storey: 0, x: 12.65, z: 7, facing: '-x' },
    { piece: 'Light_Small', storey: 0, x: 12.55, z: 7, y: 2.3 },
    ...[-5, -3.5, -2, 2, 3.5, 5].map((x): FurnitureSpec => ({
      piece: 'Chair_2',
      storey: 0,
      x,
      z: -2.4,
    })),
    { piece: 'Light_Desk', storey: 0, x: -5, z: -1, y: 1.1, facing: '-z' },
    { piece: 'Light_Desk', storey: 0, x: 5, z: -1, y: 1.1, facing: '-z' },
    ...shelfWall(0, { z: back }, [-4, -2.3, -0.6, 2.26, 3.95, 5.64]),
    ...shelfWall(0, { z: back }, [0.83], 'Bookshelf'),
    { piece: 'Drawer_3', storey: 0, x: 9, z: -10.5, solid: true },
    { piece: 'Trashcan_Cylindric', storey: 0, x: -6.5, z: -2.6 },
    { piece: 'Light_Chandelier', storey: 0, x: -6, z: 3 },
    { piece: 'Light_Chandelier', storey: 0, x: 6, z: 3 },
    { piece: 'Light_Chandelier', storey: 0, x: 0, z: 8 },
    // Storeys 1 and 2: desks in the front offices, files along the back wall, a plant by the lift.
    ...[1, 2].flatMap((s): FurnitureSpec[] => [
      ...deskRow(s, [4], 5.5),
      ...deskRow(s, [4, 11], 9),
      ...shelfWall(s, { z: back }, [-3, -1.3, 0.4, 2.1, 3.8, 5.5]),
      { piece: 'Door_Double', storey: s, x: 12.65, z: 7, facing: '-x' },
      { piece: 'Houseplant_6', storey: s, x: 12.2, z: 9.8, scale: 1.5 },
      { piece: 'Houseplant_8', storey: s, x: -12.3, z: 10.2, scale: 1.6 },
      { piece: 'Trashcan_Cylindric', storey: s, x: 6.5, z: 5.5 },
    ]),
    ...boardTable(1, -8, 7, 1.4, 6),
    ...boardTable(2, -8, 7, 1.4, 6),
    // Storey 3: the executive floor. A boardroom in front of the vault and a lounge by the lift.
    ...boardTable(3, -3, 6, 1.8, 8),
    { piece: 'Couch_Large1', storey: 3, x: -11.8, z: 3, facing: '+x', solid: true },
    { piece: 'Table_RoundSmall', storey: 3, x: -10.4, z: 3, scale: 0.55, solid: true },
    ...waitingCorner(3, 7.5, front),
    { piece: 'Door_Double', storey: 3, x: 12.65, z: 7, facing: '-x' },
    ...shelfWall(3, { z: back }, [-3, -1.3, 0.4], 'Bookshelf'),
    { piece: 'Houseplant_6', storey: 3, x: 12.2, z: 9.8, scale: 1.5 },
  ];
  return {
    cladding: 'sandstone',
    rooms: [
      { storey: 0, x: 0, z: 0, width: 26, depth: 22, floor: 'tile' },
      { storey: 0, x: 0, z: -6, width: 26, depth: 10, floor: 'wood', walls: 'panel' },
      ...[1, 2].map((storey) => ({
        storey,
        x: 4.5,
        z: 6.5,
        width: 17,
        depth: 9,
        floor: 'carpet' as const,
        walls: 'panel' as const,
      })),
      { storey: 3, x: 0, z: 0, width: 26, depth: 22, floor: 'wood', walls: 'panel' },
      { storey: 3, x: 8, z: -6, width: 10, depth: 10, floor: 'steel', walls: 'steel' },
    ],
    facade: { pilasters: [-10, -6.5, 6.5, 10], lamps: [-2.7, 2.7], atm: 5, sign: true },
    fixtures: [
      { kind: 'tellerScreen', storey: 0, x: -3.5, z: -1, width: 5, facing: '+z' },
      { kind: 'tellerScreen', storey: 0, x: 3.5, z: -1, width: 5, facing: '+z' },
      { kind: 'queuePosts', storey: 0, x: 0, z: 2.5, width: 6, facing: '+z' },
    ],
    furniture,
  };
}
