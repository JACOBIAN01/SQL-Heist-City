import type { BankLayout } from './BankLayout';
import { BANK_1 } from './bank1';

/** Every bank that has a layout, by tier. Tiers without one stand as closed buildings (Phase 9 adds them). */
export const BANK_LAYOUTS: ReadonlyMap<number, BankLayout> = new Map([[BANK_1.tier, BANK_1]]);

/** Footprint a tier's bank site reserves: its own layout's, or Bank 1's until it has one. */
export function bankFootprint(tier: number): { width: number; depth: number } {
  const layout = BANK_LAYOUTS.get(tier) ?? BANK_1;
  return { width: layout.width, depth: layout.depth };
}
