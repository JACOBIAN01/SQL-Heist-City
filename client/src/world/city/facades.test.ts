import { describe, expect, it } from 'vitest';
import { SeededRng } from '@heist/shared';
import { FACADE_STYLES, placeFacade, sideOf, type FacadeBuilding } from './facades';
import { turnAlong, turnNormal, type Turn } from './plan';

const rect = { minX: 0, maxX: 8, minZ: 0, maxZ: 6 };
const style = FACADE_STYLES.brick;
const building = (over: Partial<FacadeBuilding> = {}): FacadeBuilding => ({
  rect,
  storeys: 3,
  storeyHeight: 3,
  style,
  sides: ([0, 1, 2, 3] as Turn[]).map((turn) => ({ turn, street: turn === 0, hiddenStoreys: 0 })),
  ...over,
});
const rng = () => new SeededRng('facade');

describe('turns and sides', () => {
  it('walks each side so the turned piece faces out of the footprint', () => {
    for (const turn of [0, 1, 2, 3] as Turn[]) {
      const side = sideOf(rect, turn);
      const along = turnAlong(turn);
      const out = turnNormal(turn);
      // The middle of the side, nudged outward, is outside the rect.
      const mx = side.x + (along.x * side.length) / 2 + out.x * 0.1;
      const mz = side.z + (along.z * side.length) / 2 + out.z * 0.1;
      const outside = mx < rect.minX || mx > rect.maxX || mz < rect.minZ || mz > rect.maxZ;
      expect(outside).toBe(true);
      // Walking the full length ends on the next corner of the rect.
      const ex = side.x + along.x * side.length;
      const ez = side.z + along.z * side.length;
      expect([rect.minX, rect.maxX]).toContain(ex);
      expect([rect.minZ, rect.maxZ]).toContain(ez);
    }
  });
});

describe('placeFacade', () => {
  it('puts one piece per 2 m module per storey, plus a cornice per module', () => {
    const ps = placeFacade(building(), rng());
    const modules = (8 + 6 + 8 + 6) / 2;
    expect(ps.filter((p) => p.piece === style.cornice)).toHaveLength(modules);
    expect(ps.filter((p) => p.piece !== style.cornice)).toHaveLength(modules * 3);
    expect(ps.filter((p) => p.piece === style.cornice).every((p) => p.y === 9)).toBe(true);
  });

  it('dresses only street sides with windows and shop fronts, each with a chosen interior', () => {
    const ps = placeFacade(building(), rng());
    const fancy = ps.filter((p) => p.piece === style.window || p.piece === style.shop);
    expect(fancy.length).toBeGreaterThan(0);
    expect(fancy.every((p) => p.turn === 0)).toBe(true);
    expect(fancy.every((p) => p.interior !== undefined)).toBe(true);
    expect(
      ps.filter((p) => p.turn !== 0 && p.y > 0 && p.y < 9).every((p) => p.piece === style.wall),
    ).toBe(true);
  });

  it('skips the storeys a neighbour hides, and the ground floor in a door gap', () => {
    const ps = placeFacade(
      building({
        sides: [
          { turn: 0, street: true, hiddenStoreys: 0, gap: { from: 3, to: 5 } },
          { turn: 1, street: false, hiddenStoreys: 2 },
          { turn: 2, street: false, hiddenStoreys: 3 },
        ],
      }),
      rng(),
    );
    expect(ps.filter((p) => p.turn === 2)).toEqual([]);
    expect(
      ps.filter((p) => p.turn === 1 && p.piece !== style.cornice).every((p) => p.y === 6),
    ).toBe(true);
    // Modules centred at 3 and 5 overlap the 3–5 m gap; the ground floor there stays open.
    const ground = ps.filter((p) => p.turn === 0 && p.y === 0).map((p) => p.x);
    expect(ground).toEqual([1, 7]);
  });

  it('pushes the facade out by the outset', () => {
    const ps = placeFacade(building({ outset: 0.22 }), rng());
    expect(ps.filter((p) => p.turn === 0).every((p) => p.z === 6.22)).toBe(true);
    expect(ps.filter((p) => p.turn === 3).every((p) => p.x === -0.22)).toBe(true);
  });

  it('is deterministic for the same random stream', () => {
    expect(placeFacade(building(), rng())).toEqual(placeFacade(building(), rng()));
  });
});
