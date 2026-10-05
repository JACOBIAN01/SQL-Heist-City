import type { BankLayout } from './BankLayout';
import { BANK_1 } from './bank1';
import { BANK_2 } from './bank2';
import { BANK_3 } from './bank3';
import { BANK_4 } from './bank4';

/** Every bank that has a layout, by tier. Tiers without one stand as closed buildings (Phase 9 adds them). */
export const BANK_LAYOUTS: ReadonlyMap<number, BankLayout> = new Map(
  [BANK_1, BANK_2, BANK_3, BANK_4].map((bank) => [bank.tier, bank]),
);

/** Footprint a tier's bank site reserves: its own layout's, or Bank 1's until it has one. */
export function bankFootprint(tier: number): { width: number; depth: number } {
  const layout = BANK_LAYOUTS.get(tier) ?? BANK_1;
  return { width: layout.width, depth: layout.depth };
}
