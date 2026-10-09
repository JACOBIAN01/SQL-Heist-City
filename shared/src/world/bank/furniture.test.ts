import { describe, expect, it } from 'vitest';
import type { BankLayout, FurnitureSpec } from './BankLayout';
import { BANK_1 } from './bank1';
import { compileBank, validateBank } from './compileBank';
import { ceilingHeight, placeFurniture } from './furniture';
import { FURNITURE_PIECES } from './furniturePieces';

const withFurniture = (...furniture: FurnitureSpec[]): BankLayout => ({ ...BANK_1, furniture });

describe('placeFurniture', () => {
  const at = { x: 100, z: 50 };

  it('stands a piece on its storey floor, at the bank position, facing the street by default', () => {
    const [p] = placeFurniture(withFurniture({ piece: 'Drawer_3', storey: 1, x: 2, z: -3 }), at);
    expect(p).toMatchObject({ x: 102, y: 3, z: 47, yaw: 0, scale: 1, solid: false });
    const d = FURNITURE_PIECES.Drawer_3;
    expect(p?.bounds.minX).toBeCloseTo(102 + d.min[0]);
    expect(p?.bounds.maxZ).toBeCloseTo(47 + d.max[2]);
  });

  it('turns the footprint with the facing', () => {
    const d = FURNITURE_PIECES.Drawer_3; // wider (x) than deep (z)
    const [side] = placeFurniture(
      withFurniture({ piece: 'Drawer_3', storey: 0, x: 0, z: 0, facing: '+x' }),
      { x: 0, z: 0 },
    );
    expect(side?.yaw).toBeCloseTo(Math.PI / 2);
    expect(side ? side.bounds.maxX - side.bounds.minX : 0).toBeCloseTo(d.max[2] - d.min[2]);
    expect(side ? side.bounds.maxZ - side.bounds.minZ : 0).toBeCloseTo(d.max[0] - d.min[0]);
  });

  it('hangs ceiling lights from the ceiling: the slab above, or the roof on top', () => {
    const [low, top] = placeFurniture(
      withFurniture(
        { piece: 'Light_Chandelier', storey: 0, x: 0, z: 3 },
        { piece: 'Light_Chandelier', storey: 2, x: 0, z: 3 },
      ),
      { x: 0, z: 0 },
    );
    expect(low?.y).toBeCloseTo(ceilingHeight(BANK_1, 0));
    expect(top?.y).toBeCloseTo(6 + ceilingHeight(BANK_1, 2));
    expect(ceilingHeight(BANK_1, 2)).toBe(BANK_1.storeyHeight);
  });

  it('scales the piece and its footprint', () => {
    const [p] = placeFurniture(
      withFurniture({ piece: 'Table_RoundLarge', storey: 0, x: 0, z: 0, scale: 2 }),
      { x: 0, z: 0 },
    );
    expect(p ? p.bounds.maxY : 0).toBeCloseTo(FURNITURE_PIECES.Table_RoundLarge.max[1] * 2);
  });
});

describe('furniture in the compiled bank', () => {
  it('turns solid pieces into colliders, and leaves decoration out', () => {
    const boxes = compileBank(
      withFurniture(
        { piece: 'Drawer_3', storey: 0, x: -6, z: 6, solid: true },
        { piece: 'Houseplant_8', storey: 0, x: -10, z: 7 },
      ),
      { x: 0, z: 0 },
    );
    // Storey 0 only: the vault's fittings upstairs are solid too.
    const solid = boxes.filter((b) => b.kind === 'furniture' && b.minY === 0);
    expect(solid).toHaveLength(1);
    expect(solid[0]?.minY).toBe(0);
    expect(((solid[0]?.minX ?? 0) + (solid[0]?.maxX ?? 0)) / 2).toBeCloseTo(-6, 1);
  });

  it("makes the vault's deposit boxes and cash shelves solid, against their walls", () => {
    const vaultFloor = 2 * BANK_1.storeyHeight;
    const fittings = compileBank(BANK_1, { x: 0, z: 0 }).filter(
      (b) => b.kind === 'furniture' && b.minY === vaultFloor,
    );
    expect(fittings).toHaveLength(3);
    const back = fittings.find((b) => b.minZ < -8.7);
    expect(back).toMatchObject({ minX: 4.5, maxX: 11.5, maxY: vaultFloor + 2.2 });
    expect(back ? back.maxZ - back.minZ : 0).toBeCloseTo(0.35);
  });

  it('refuses unknown pieces, missing storeys and pieces outside the walls', () => {
    expect(() => validateBank(withFurniture({ piece: 'Piano', storey: 0, x: 0, z: 0 }))).toThrow(
      /not a furniture piece/,
    );
    expect(() => validateBank(withFurniture({ piece: 'Chair_1', storey: 7, x: 0, z: 0 }))).toThrow(
      /missing storey/,
    );
    expect(() =>
      validateBank(withFurniture({ piece: 'Couch_Large1', storey: 0, x: 11.5, z: 0 })),
    ).toThrow(/leaves the footprint/);
    expect(() =>
      validateBank({ ...BANK_1, rooms: [{ storey: 0, x: 10, z: 0, width: 8, depth: 4 }] }),
    ).toThrow(/room at \(10,0\) on storey 0 leaves the footprint/);
  });
});
