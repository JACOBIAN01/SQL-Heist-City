import type { BankLayout } from './BankLayout';

/**
 * Bank 1 "Corner Savings": a 24 × 18 m, three-storey starter bank. 7.1 lays
 * out the ground floor (lobby, teller counter, security room) with two stair flights
 * up to the top storey (the elevator is an interaction, see 7.3). Front (street side) is +z.
 */
export const BANK_1: BankLayout = {
  id: 'bank-1',
  name: 'Corner Savings',
  tier: 1,
  width: 24,
  depth: 18,
  storeys: 3,
  storeyHeight: 3,
  entrance: { x: 0, width: 3, height: 2.6 },
  // Back-left corner. Flight 1 climbs toward the back wall from the lobby onto a landing; flight 2
  // starts a metre off the back wall beside it and climbs forward onto the top storey.
  stairs: [
    { storey: 0, x: -10, z: -4.4, width: 2, heading: '-z', steps: 12, tread: 0.4 },
    { storey: 1, x: -7.5, z: -5.4, width: 2, heading: '+z', steps: 12, tread: 0.4 },
  ],
  // One lift per storey at the east end of the lobby; F rides to the next storey up (top → ground).
  anchors: [
    { id: 'lift:0', kind: 'elevator', storey: 0, x: 9.5, z: 5 },
    { id: 'lift:1', kind: 'elevator', storey: 1, x: 9.5, z: 5 },
    { id: 'lift:2', kind: 'elevator', storey: 2, x: 9.5, z: 5 },
  ],
  // The vault: back-right room of the top storey. Its west wall (x = 4) has a 2.4 m doorway
  // (z -6.5 … -4.1) that the door fills until the last lock opens.
  vaults: [
    {
      id: 'vault',
      storey: 2,
      door: { x: 4, z: -5.3, width: 0.3, depth: 2.4, height: 2.4 },
      console: { x: 2.4, z: -5.3 },
      loot: [
        { x: 6, z: -7.5 },
        { x: 8.5, z: -7.5 },
        { x: 11, z: -7.5 },
        { x: 7, z: -3 },
        { x: 10, z: -3 },
      ],
      // Deposit boxes on the back and east walls, cash shelves on the north wall.
      fittings: {
        depositBoxes: [
          { x: 8, z: -8.8, width: 7, facing: '+z' },
          { x: 11.8, z: -5, width: 3.6, facing: '-x' },
        ],
        cashShelves: [{ x: 8, z: -1.1, width: 5, facing: '-z' }],
      },
    },
  ],
  floors: [
    {
      walls: [
        // Vault room, back-right corner. A 2 m staff door opens onto the lobby.
        {
          from: { x: 4, z: -9 },
          to: { x: 4, z: -1 },
          openings: [{ at: 2.5, width: 2, height: 2.4 }],
        },
        { from: { x: 4, z: -1 }, to: { x: 12, z: -1 } },
      ],
      blocks: [
        // Teller counter with a gap in the middle for staff to walk through.
        { x: -5.5, z: -2, width: 6, depth: 1, height: 1.1 },
        { x: 0.5, z: -2, width: 2, depth: 1, height: 1.1 },
      ],
    },
    {
      // Storey 1: empty offices for now.
      walls: [],
      blocks: [],
    },
    {
      // Storey 2: the vault room, doorway facing the stairs.
      walls: [
        {
          from: { x: 4, z: -9 },
          to: { x: 4, z: -1 },
          openings: [{ at: 2.5, width: 2.4, height: 2.4 }],
        },
        { from: { x: 4, z: -1 }, to: { x: 12, z: -1 } },
      ],
      blocks: [],
    },
  ],
  // Finishes: a marble lobby, wood behind the counter, tiles in the back office, carpeted
  // offices upstairs, a steel vault.
  rooms: [
    { storey: 0, x: -4, z: -5.75, width: 16, depth: 6.5, floor: 'wood' },
    { storey: 0, x: 8, z: -5, width: 8, depth: 8, floor: 'tile', walls: 'panel' },
    { storey: 1, x: 0, z: 0, width: 24, depth: 18, floor: 'carpet', walls: 'panel' },
    { storey: 2, x: 8, z: -5, width: 8, depth: 8, floor: 'steel', walls: 'steel' },
    // The executive floor outside the vault: a wood-floored, panelled boardroom.
    { storey: 2, x: -4, z: 4, width: 16, depth: 10, floor: 'wood', walls: 'panel' },
  ],
  // The ground floor (11.5): a waiting corner and queue in the lobby, tellers behind a glass
  // screen, shelves of ledgers on the back wall, a security room with two desks. Solid pieces
  // keep clear of the stairs, the lift and the lines walked in compileBank.test.
  // The street front: engaged columns, a plaque over the door, lanterns, a cash machine.
  facade: { pilasters: [-10, -7, -4, 4, 7, 10], lamps: [-2.7, 2.7], atm: 5.5, sign: true },
  fixtures: [
    { kind: 'tellerScreen', storey: 0, x: -5.5, z: -2, width: 6, facing: '+z' },
    { kind: 'tellerScreen', storey: 0, x: 0.5, z: -2, width: 2, facing: '+z' },
    { kind: 'queuePosts', storey: 0, x: -3, z: 1, width: 7.2, facing: '+z' },
    { kind: 'queuePosts', storey: 0, x: -6.6, z: 2.5, width: 3, facing: '+x' },
  ],
  furniture: [
    // Waiting corner under the front wall.
    { piece: 'Couch_Medium1', storey: 0, x: -9, z: 8.2, facing: '-z', solid: true },
    { piece: 'Couch_Medium1', storey: 0, x: -5.5, z: 8.2, facing: '-z', solid: true },
    { piece: 'Table_RoundSmall', storey: 0, x: -7.2, z: 7, scale: 0.6, solid: true },
    { piece: 'Carpet_1', storey: 0, x: -7.2, z: 6.9, facing: '+x' },
    { piece: 'Houseplant_8', storey: 0, x: -11.3, z: 8.2, scale: 1.6 },
    { piece: 'Houseplant_8', storey: 0, x: -3.9, z: 8.2, scale: 1.6 },
    // Columns flank the door and the lobby's middle.
    { piece: 'Column_Round3', storey: 0, x: -3, z: 8.3, solid: true },
    { piece: 'Column_Round3', storey: 0, x: 3, z: 8.3, solid: true },
    { piece: 'Column_Round3', storey: 0, x: -3.2, z: 3.4, solid: true },
    { piece: 'Column_Round3', storey: 0, x: 3.2, z: 3.4, solid: true },
    // The lift: doors on the east wall, a lamp over them.
    { piece: 'Door_Double', storey: 0, x: 11.65, z: 5, facing: '-x' },
    { piece: 'Light_Small', storey: 0, x: 11.55, z: 5, y: 2.3 },
    { piece: 'Houseplant_6', storey: 0, x: 11.2, z: 7.6, scale: 1.5 },
    // Tellers: a chair and a desk lamp at each window.
    { piece: 'Chair_2', storey: 0, x: -7.2, z: -3.3 },
    { piece: 'Chair_2', storey: 0, x: -5.5, z: -3.3 },
    { piece: 'Chair_2', storey: 0, x: -3.8, z: -3.3 },
    { piece: 'Chair_2', storey: 0, x: 0.5, z: -3.3 },
    { piece: 'Light_Desk', storey: 0, x: -7.2, z: -2, y: 1.1, facing: '-z' },
    { piece: 'Light_Desk', storey: 0, x: -3.8, z: -2, y: 1.1, facing: '-z' },
    // Ledgers and files on the back wall.
    { piece: 'Shelf_Large', storey: 0, x: -5, z: -8.6, solid: true },
    { piece: 'Shelf_Large', storey: 0, x: -3.2, z: -8.6, solid: true },
    { piece: 'Drawer_3', storey: 0, x: -0.4, z: -8.6, solid: true },
    { piece: 'Bookshelf', storey: 0, x: 2.2, z: -8.6, solid: true },
    { piece: 'Trashcan_Cylindric', storey: 0, x: -1.3, z: -3.4 },
    // The security room: two desks on its front wall, files on the back wall.
    { piece: 'Drawer_2', storey: 0, x: 6.5, z: -1.7, facing: '-z', solid: true },
    { piece: 'Drawer_2', storey: 0, x: 9.5, z: -1.7, facing: '-z', solid: true },
    { piece: 'Chair_3', storey: 0, x: 6.5, z: -2.6 },
    { piece: 'Chair_3', storey: 0, x: 9.5, z: -2.6 },
    { piece: 'Light_Desk', storey: 0, x: 7, z: -1.7, y: 0.65, facing: '-z' },
    { piece: 'Shelf_Large', storey: 0, x: 7, z: -8.6, solid: true },
    { piece: 'Shelf_Large', storey: 0, x: 9, z: -8.6, solid: true },
    { piece: 'Bookshelf', storey: 0, x: 11, z: -8.6, solid: true },
    { piece: 'Houseplant_8', storey: 0, x: 11.3, z: -1.7, scale: 1.6 },
    // Storey 1, open-plan offices: two rows of desks with chairs and lamps, files on the east
    // wall, a meeting table in the front corner. Clear of both flights and the lift.
    ...[-3, 0, 3, 6].flatMap((x) => [
      { piece: 'Drawer_3', storey: 1, x, z: 1.5, facing: '-z', solid: true } as const,
      { piece: 'Chair_3', storey: 1, x, z: 2.5, facing: '-z' } as const,
      { piece: 'Light_Desk', storey: 1, x: x + 0.7, z: 1.5, y: 0.79, facing: '-z' } as const,
    ]),
    ...[-2.5, 0.5, 3.5, 6.5].flatMap((x) => [
      { piece: 'Drawer_3', storey: 1, x, z: -3.5, facing: '-z', solid: true } as const,
      { piece: 'Chair_3', storey: 1, x, z: -2.5, facing: '-z' } as const,
      { piece: 'Light_Desk', storey: 1, x: x + 0.7, z: -3.5, y: 0.79, facing: '-z' } as const,
    ]),
    { piece: 'Bookshelf', storey: 1, x: 11.6, z: -7.2, facing: '-x', solid: true },
    { piece: 'Bookshelf', storey: 1, x: 11.6, z: -5.8, facing: '-x', solid: true },
    { piece: 'Shelf_Large', storey: 1, x: 11.6, z: -3.9, facing: '-x', solid: true },
    { piece: 'Shelf_Large', storey: 1, x: 11.6, z: -2, facing: '-x', solid: true },
    { piece: 'Houseplant_6', storey: 1, x: 11.2, z: 7.6, scale: 1.5 },
    { piece: 'Door_Double', storey: 1, x: 11.65, z: 5, facing: '-x' },
    { piece: 'Table_RoundLarge', storey: 1, x: -7, z: 5.5, scale: 1.3, solid: true },
    ...[-8.2, -7, -5.8].flatMap((x) => [
      { piece: 'Chair_2', storey: 1, x, z: 4.4 } as const,
      { piece: 'Chair_2', storey: 1, x, z: 6.6, facing: '-z' } as const,
    ]),
    { piece: 'Carpet_1', storey: 1, x: -7, z: 5.5, facing: '+x' },
    { piece: 'Houseplant_8', storey: 1, x: -11.3, z: 8.2, scale: 1.6 },
    { piece: 'Trashcan_Cylindric', storey: 1, x: -2, z: -1.4 },
    { piece: 'Light_Chandelier', storey: 1, x: -7, z: 5.5 },
    // Storey 2, the executive floor: a boardroom table with eight chairs, couches, a wall of
    // files, and a lounge by the lift.
    { piece: 'Table_RoundLarge', storey: 2, x: -3, z: 5, scale: 1.8, solid: true },
    ...[-4.2, -3, -1.8].flatMap((x) => [
      { piece: 'Chair_3', storey: 2, x, z: 3.4 } as const,
      { piece: 'Chair_3', storey: 2, x, z: 6.6, facing: '-z' } as const,
    ]),
    { piece: 'Chair_3', storey: 2, x: -5.9, z: 5, facing: '+x' },
    { piece: 'Chair_3', storey: 2, x: -0.1, z: 5, facing: '-x' },
    { piece: 'Light_Chandelier', storey: 2, x: -3, z: 5 },
    { piece: 'Couch_Large1', storey: 2, x: -11, z: 1.5, facing: '+x', solid: true },
    { piece: 'Table_RoundSmall', storey: 2, x: -9.6, z: 1.5, scale: 0.55, solid: true },
    { piece: 'Houseplant_8', storey: 2, x: -11.3, z: 8.2, scale: 1.6 },
    { piece: 'Shelf_Large', storey: 2, x: -4.2, z: -8.6, solid: true },
    { piece: 'Shelf_Large', storey: 2, x: -2.4, z: -8.6, solid: true },
    { piece: 'Bookshelf', storey: 2, x: -0.6, z: -8.6, solid: true },
    { piece: 'Carpet_Round', storey: 2, x: -3, z: 5, scale: 1.8 },
    { piece: 'Couch_Medium1', storey: 2, x: 7, z: 8.2, facing: '-z', solid: true },
    { piece: 'Table_RoundSmall', storey: 2, x: 7, z: 6.6, scale: 0.55, solid: true },
    { piece: 'Houseplant_6', storey: 2, x: 11.2, z: 7.6, scale: 1.5 },
    { piece: 'Door_Double', storey: 2, x: 11.65, z: 5, facing: '-x' },
    { piece: 'Light_Chandelier', storey: 0, x: -7, z: 4 },
    { piece: 'Light_Chandelier', storey: 0, x: 2, z: 4 },
  ],
};
