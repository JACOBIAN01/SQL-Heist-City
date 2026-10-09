import type { BankLayout, FurnitureSpec } from './BankLayout';
import { boardTable, deskRow, shelfWall, waitingCorner, workstation } from './dressing';

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
      fittings: {
        depositBoxes: [
          { x: 0, z: -13.8, width: 9, facing: '+z' },
          { x: -6.9, z: -9.5, width: 5, facing: '+x' },
          { x: 6.9, z: -9.5, width: 5, facing: '-x' },
        ],
        cashShelves: [
          { x: -4, z: -5.1, width: 2, facing: '-z' },
          { x: 4, z: -5.1, width: 2, facing: '-z' },
        ],
      },
    },
  ],
  floors: [
    {
      // Ground: a long lobby, the counter split by a staff gap, pillars and a guard desk.
      walls: [],
      blocks: [
        { x: -4, z: -3, width: 6, depth: 1, height: 1.1 },
        { x: 4, z: -3, width: 6, depth: 1, height: 1.1 },
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
      blocks: [],
    },
    { walls: [], blocks: [] },
    {
      // Storey 3: the trading floor everyone must cross, from the west stairs to the east ones.
      walls: [],
      blocks: [
        { x: -2, z: 8, width: 3, depth: 0.6, height: 1.2, kind: 'cover' as const },
        { x: 3, z: -9, width: 3, depth: 0.6, height: 1.2, kind: 'cover' as const },
      ],
    },
    { walls: [], blocks: [] },
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
  ...dressing(),
};

/**
 * Tier 5: white marble outside and marble walls inside, brass everywhere,
 * chandeliers over every public room. The richest bank looks it.
 */
function dressing(): Pick<BankLayout, 'cladding' | 'rooms' | 'facade' | 'fixtures' | 'furniture'> {
  const front = 13.2; // couches against the front wall
  const back = -13.8; // inner face of the back wall
  const lift = (storey: number): FurnitureSpec => ({
    piece: 'Door_Double',
    storey,
    x: 13.65,
    z: -10,
    facing: '-x',
  });
  const furniture: FurnitureSpec[] = [
    // Ground floor: four columns, waiting corners, the guard's desk, tellers, ledgers.
    ...[-4.5, 4.5].flatMap((x) =>
      [3, 8].map((z): FurnitureSpec => ({ piece: 'Column_Round3', storey: 0, x, z, solid: true })),
    ),
    ...waitingCorner(0, -8, front),
    ...waitingCorner(0, 8, front),
    { piece: 'Carpet_1', storey: 0, x: -8, z: 11.8, facing: '+x' },
    { piece: 'Carpet_1', storey: 0, x: 8, z: 11.8, facing: '+x' },
    ...workstation(0, 8, 10, -1),
    lift(0),
    { piece: 'Light_Small', storey: 0, x: 13.55, z: -10, y: 2.3 },
    ...[-6, -4, -2, 2, 4, 6].map((x): FurnitureSpec => ({
      piece: 'Chair_2',
      storey: 0,
      x,
      z: -4.4,
    })),
    { piece: 'Light_Desk', storey: 0, x: -5, z: -3, y: 1.1, facing: '-z' },
    { piece: 'Light_Desk', storey: 0, x: 5, z: -3, y: 1.1, facing: '-z' },
    ...shelfWall(0, { z: back }, [-5, -3.3, -1.6, 0.1, 1.8, 3.5, 5.2]),
    { piece: 'Trashcan_Cylindric', storey: 0, x: -7.6, z: -4.3 },
    ...[
      [-9, 5],
      [0, 3],
      [9, 5],
      [-4.5, 10],
      [4.5, 10],
      [0, -9],
    ].map(([x = 0, z = 0]): FurnitureSpec => ({ piece: 'Light_Chandelier', storey: 0, x, z })),
    // Storey 1: offices behind a wall with two doors.
    ...deskRow(1, [-4, 4], 5),
    ...deskRow(1, [-10, 10], 8),
    ...shelfWall(1, { z: back }, [-5, -3.3, -1.6, 0.1, 1.8, 3.5, 5.2]),
    lift(1),
    // Storey 2: desks and a meeting table.
    ...deskRow(2, [-4, 0, 4], 4),
    ...deskRow(2, [0], -4, -1),
    ...waitingCorner(2, 8, front),
    ...shelfWall(2, { z: back }, [-5, -3.3, -1.6, 0.1, 1.8, 3.5, 5.2]),
    lift(2),
    // Storey 3: the trading floor everyone crosses: two rows of desks.
    ...deskRow(3, [-6, 0, 6], 2),
    ...deskRow(3, [-6, 0, 6], -4, -1),
    ...shelfWall(3, { x: -13.8 }, [4, 5.7, 7.4]),
    { piece: 'Light_Chandelier', storey: 3, x: 0, z: 8 },
    // Storey 4: a few desks and a lounge.
    ...deskRow(4, [-5], 3),
    ...deskRow(4, [0], -2, -1),
    ...deskRow(4, [4], 2),
    ...waitingCorner(4, -8, front),
    lift(4),
    // Storey 5: the vault's anteroom and the boardroom in front of it.
    ...boardTable(5, 0, 8, 1.8, 8),
    ...waitingCorner(5, -8, front),
    { piece: 'Carpet_1', storey: 5, x: 0, z: -2, facing: '+x' },
    { piece: 'Houseplant_8', storey: 5, x: -6.4, z: 0.2, scale: 1.6 },
    { piece: 'Houseplant_8', storey: 5, x: 6.4, z: 0.2, scale: 1.6 },
    { piece: 'Light_Chandelier', storey: 5, x: 0, z: -2 },
    lift(5),
  ];
  return {
    cladding: 'whitestone',
    rooms: [
      { storey: 0, x: 0, z: 0, width: 28, depth: 28, floor: 'marble', walls: 'marble' },
      { storey: 0, x: 0, z: -8.5, width: 28, depth: 11, floor: 'wood', walls: 'panel' },
      { storey: 1, x: 0, z: 0, width: 28, depth: 28, floor: 'wood', walls: 'panel' },
      { storey: 2, x: 0, z: 0, width: 28, depth: 28, floor: 'carpet', walls: 'panel' },
      { storey: 3, x: 0, z: 0, width: 28, depth: 28, floor: 'carpet', walls: 'panel' },
      { storey: 4, x: 0, z: 0, width: 28, depth: 28, floor: 'wood', walls: 'panel' },
      { storey: 5, x: 0, z: 0, width: 28, depth: 28, floor: 'marble', walls: 'marble' },
      { storey: 5, x: 0, z: -2, width: 14, depth: 6, floor: 'wood', walls: 'panel' },
      { storey: 5, x: 0, z: -9.5, width: 14, depth: 9, floor: 'steel', walls: 'steel' },
    ],
    facade: {
      pilasters: [-12.5, -10, -7.5, -5, 5, 7.5, 10, 12.5],
      lamps: [-2.7, 2.7],
      atm: 3.7,
      sign: true,
    },
    fixtures: [
      { kind: 'tellerScreen', storey: 0, x: -4, z: -3, width: 6, facing: '+z' },
      { kind: 'tellerScreen', storey: 0, x: 4, z: -3, width: 6, facing: '+z' },
      { kind: 'queuePosts', storey: 0, x: 0, z: 0, width: 6, facing: '+z' },
    ],
    furniture,
  };
}
