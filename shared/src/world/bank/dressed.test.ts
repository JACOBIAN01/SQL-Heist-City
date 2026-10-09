import { describe, expect, it } from 'vitest';
import type { BankLayout } from './BankLayout';
import { BANK_1 } from './bank1';
import { BANK_2 } from './bank2';
import { BANK_3 } from './bank3';
import { compileBankWorld, validateBank } from './compileBank';
import { placeFurniture } from './furniture';

/** Every bank that has been dressed with the interior kit (Phase 11): Bank 1 and the roll-out. */
const DRESSED: readonly BankLayout[] = [BANK_1, BANK_2, BANK_3];

describe.each(DRESSED.map((b) => [b.name, b] as const))('dressed bank: %s', (_name, layout) => {
  it('has rooms, a facade, teller screens and furniture on every storey that people use', () => {
    expect(layout.rooms?.length).toBeGreaterThan(2);
    expect(layout.facade?.sign).toBe(true);
    expect(layout.fixtures?.some((f) => f.kind === 'tellerScreen')).toBe(true);
    const storeys = new Set(layout.furniture?.map((f) => f.storey));
    for (let s = 0; s < layout.storeys; s++) expect(storeys.has(s), `storey ${s}`).toBe(true);
  });

  it('fills the vault with deposit boxes and cash', () => {
    const fittings = layout.vaults?.[0]?.fittings;
    expect(fittings?.depositBoxes?.length).toBeGreaterThan(0);
    expect(fittings?.cashShelves?.length).toBeGreaterThan(0);
  });

  it('is still a valid layout with its furniture in place', () => {
    expect(() => validateBank(layout)).not.toThrow();
    const solid = placeFurniture(layout, { x: 0, z: 0 }).filter((p) => p.solid);
    const world = compileBankWorld(layout, { x: 0, z: 0 });
    expect(world.boxes.filter((b) => b.kind === 'furniture').length).toBeGreaterThanOrEqual(
      solid.length,
    );
  });

  it('uses its desks as furniture, not as bare blocks', () => {
    const deskBlocks = layout.floors
      .flatMap((f) => f.blocks)
      .filter((b) => b.height === 0.8 && b.width === 2);
    expect(deskBlocks).toEqual([]);
  });
});

describe('the look climbs with the tier', () => {
  it('clads each bank in its own stone', () => {
    expect(BANK_1.cladding ?? 'stone').toBe('stone');
    expect(BANK_2.cladding).toBe('sandstone');
    expect(BANK_3.cladding).toBe('granite');
  });
});
