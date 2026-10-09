import type { BankLayout, FurnitureSpec, StairSpec } from './BankLayout';
import { boardTable, deskRow, shelfWall, waitingCorner } from './dressing';

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
      fittings: {
        depositBoxes: [
          { x: 0, z: -11.8, width: 8, facing: '+z' },
          { x: -5.9, z: -7, width: 5, facing: '+x' },
          { x: 5.9, z: -7, width: 5, facing: '-x' },
        ],
        cashShelves: [
          { x: -4, z: -3.1, width: 2, facing: '-z' },
          { x: 4, z: -3.1, width: 2, facing: '-z' },
        ],
      },
    },
  ],
  floors: [
    {
      // Ground: a pillared lobby, the counter split by a staff gap.
      walls: [],
      blocks: [
        { x: -3.75, z: -2, width: 4.5, depth: 1, height: 1.1 },
        { x: 3.75, z: -2, width: 4.5, depth: 1, height: 1.1 },
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
      blocks: [],
    },
    {
      // Storey 2: a records room in the middle, one door facing the front.
      walls: [
        { from: { x: -5, z: -8 }, to: { x: 5, z: -8 } },
        { from: { x: -5, z: -8 }, to: { x: -5, z: 0 } },
        { from: { x: 5, z: -8 }, to: { x: 5, z: 0 } },
        { from: { x: -5, z: 0 }, to: { x: 5, z: 0 }, openings: [{ at: 4, width: 2, height: 2.4 }] },
      ],
      blocks: [],
    },
    {
      // Storey 3: open floor with desks.
      walls: [],
      blocks: [],
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
  ...dressing(),
};

/**
 * Tier 4: pale limestone outside, marble and panelling in the public rooms,
 * wood in the offices, chandeliers over the hall. Two stair cores in the back
 * corners and a lift at the front-right stay clear.
 */
function dressing(): Pick<BankLayout, 'cladding' | 'rooms' | 'facade' | 'fixtures' | 'furniture'> {
  const front = 11.2; // couches against the front wall
  const back = -11.8; // inner face of the back wall
  const lift = (storey: number): FurnitureSpec => ({
    piece: 'Door_Double',
    storey,
    x: 13.65,
    z: 9,
    facing: '-x',
  });
  const furniture: FurnitureSpec[] = [
    // Ground floor: four pillars, waiting corners, tellers behind glass, ledgers behind them.
    ...[-4, 4].flatMap((x) =>
      [3, 8].map((z): FurnitureSpec => ({ piece: 'Column_Round3', storey: 0, x, z, solid: true })),
    ),
    ...waitingCorner(0, -9, front),
    ...waitingCorner(0, 6, front),
    { piece: 'Carpet_1', storey: 0, x: -9, z: 9.8, facing: '+x' },
    lift(0),
    { piece: 'Light_Small', storey: 0, x: 13.55, z: 9, y: 2.3 },
    ...[-5.5, -3.75, -2, 2, 3.75, 5.5].map((x): FurnitureSpec => ({
      piece: 'Chair_2',
      storey: 0,
      x,
      z: -3.4,
    })),
    { piece: 'Light_Desk', storey: 0, x: -5, z: -2, y: 1.1, facing: '-z' },
    { piece: 'Light_Desk', storey: 0, x: 5, z: -2, y: 1.1, facing: '-z' },
    ...shelfWall(0, { z: back }, [-6.5, -4.8, -3.1, -1.4, 0.3, 2, 3.7, 5.4]),
    { piece: 'Trashcan_Cylindric', storey: 0, x: -6.6, z: -3.3 },
    ...[-9, 0, 9].map((x): FurnitureSpec => ({ piece: 'Light_Chandelier', storey: 0, x, z: 5.5 })),
    { piece: 'Light_Chandelier', storey: 0, x: 0, z: 10 },
    // Storey 1: offices along the front behind a wall with two doors; archives behind.
    ...deskRow(1, [-9, -6.8, 0.5, 7], 8),
    ...boardTable(1, 0, -2, 1.5, 6),
    ...shelfWall(1, { z: back }, [-6, -4.3, -2.6, -0.9, 0.8, 2.5, 4.2]),
    lift(1),
    // Storey 2: a records room of shelves round its walls, a table in the middle.
    ...shelfWall(2, { x: -4.9 }, [-7, -5.3, -3.6, -1.9]),
    ...shelfWall(2, { x: 4.9 }, [-7, -5.3, -3.6, -1.9]),
    ...shelfWall(2, { z: -7.9 }, [-3.3, -1.6, 0.1, 1.8, 3.5]),
    { piece: 'Table_RoundLarge', storey: 2, x: 0, z: -4, solid: true },
    { piece: 'Chair_3', storey: 2, x: -0.7, z: -5.1 },
    { piece: 'Chair_3', storey: 2, x: 0.7, z: -2.9, facing: '-z' },
    { piece: 'Light_Chandelier', storey: 2, x: 0, z: -4 },
    ...waitingCorner(2, -6, front),
    { piece: 'Houseplant_6', storey: 2, x: 12.8, z: 11.2, scale: 1.5 },
    lift(2),
    // Storey 3: an open floor of desks in two rows.
    ...deskRow(3, [-5, 0, 5], 2, -1),
    ...deskRow(3, [-5, 0, 5], 7),
    ...shelfWall(3, { z: back }, [-6, -4.3, -2.6, -0.9, 0.8, 2.5, 4.2]),
    lift(3),
    // Storey 4: the executive floor in front of the vault.
    ...boardTable(4, 0, 6, 1.8, 8),
    ...waitingCorner(4, 6, front),
    ...waitingCorner(4, -6, front),
    { piece: 'Light_Chandelier', storey: 4, x: 0, z: 10 },
    lift(4),
  ];
  return {
    cladding: 'limestone',
    rooms: [
      { storey: 0, x: 0, z: 0, width: 28, depth: 24, floor: 'marble', walls: 'panel' },
      { storey: 0, x: 0, z: -7, width: 28, depth: 10, floor: 'wood', walls: 'panel' },
      { storey: 1, x: 0, z: 8, width: 28, depth: 8, floor: 'wood', walls: 'panel' },
      { storey: 2, x: 0, z: -4, width: 10, depth: 8, floor: 'wood', walls: 'panel' },
      { storey: 3, x: 0, z: 0, width: 28, depth: 24, floor: 'carpet', walls: 'panel' },
      { storey: 4, x: 0, z: 0, width: 28, depth: 24, floor: 'wood', walls: 'panel' },
      { storey: 4, x: 0, z: -7.5, width: 12, depth: 9, floor: 'steel', walls: 'steel' },
    ],
    facade: { pilasters: [-12, -9.5, -7, 7, 9.5, 12], lamps: [-3.1, 3.1], atm: 4.7, sign: true },
    fixtures: [
      { kind: 'tellerScreen', storey: 0, x: -3.75, z: -2, width: 4.5, facing: '+z' },
      { kind: 'tellerScreen', storey: 0, x: 3.75, z: -2, width: 4.5, facing: '+z' },
      { kind: 'queuePosts', storey: 0, x: 0, z: 1, width: 6, facing: '+z' },
    ],
    furniture,
  };
}

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
