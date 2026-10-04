import type { BankLayout } from './BankLayout';

/**
 * Bank 1 "Corner Savings": a 24 × 18 m, three-storey starter bank. 7.1 lays
 * out the ground floor (lobby, teller counter, vault room); stairs and upper
 * floors follow in 7.2. Front (street side) is +z.
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
        { x: -8, z: -2, width: 7, depth: 1, height: 1.1 },
        { x: 0.5, z: -2, width: 2, depth: 1, height: 1.1 },
      ],
    },
  ],
};
