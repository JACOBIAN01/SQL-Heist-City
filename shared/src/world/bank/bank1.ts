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
};
