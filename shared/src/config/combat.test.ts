import { describe, expect, it } from 'vitest';
import {
  combatSettingsSchema,
  damageAt,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_WEAPONS,
  spreadFor,
  WEAPON_IDS,
  weaponSpecSchema,
} from './combat';

const w = (id: string) => {
  const spec = DEFAULT_WEAPONS[id];
  if (!spec) throw new Error(id);
  return spec;
};
const SPRINT = 6.8;

describe('weapon table', () => {
  it('has a gun for every wire id', () => {
    for (const id of WEAPON_IDS) expect(DEFAULT_COMBAT_SETTINGS.weapons[id]).toBeDefined();
  });

  it('reads an old stored gun (no falloff, zoom or recoil) with neutral defaults', () => {
    const old = weaponSpecSchema.parse({ damage: 10, rpm: 100, range: 30, magSize: 5 });
    expect(old).toMatchObject({
      falloffMin: 1,
      moveSpread: 0,
      aimSpread: 1,
      aimZoom: 1,
      recoil: 0,
    });
    expect(damageAt(old, 29)).toBe(10);
    expect(spreadFor(old, SPRINT, SPRINT, true)).toBe(0);
  });

  it('rejects impossible numbers', () => {
    expect(() =>
      combatSettingsSchema.parse({
        weapons: { pistol: { damage: 1, rpm: 1, range: 1, magSize: 1, aimZoom: 0.5 } },
      }),
    ).toThrow();
  });
});

describe('damageAt', () => {
  it('is full up close, then falls off to the minimum at full range', () => {
    const shotgun = w('shotgun');
    expect(damageAt(shotgun, 2)).toBe(9);
    expect(damageAt(shotgun, 6)).toBe(9);
    expect(damageAt(shotgun, 15)).toBeCloseTo(9 * 0.25);
    expect(damageAt(shotgun, 10.5)).toBeCloseTo(9 * (1 - 0.5 * 0.75));
    expect(damageAt(shotgun, 40)).toBeCloseTo(9 * 0.25);
  });

  it('never falls off for the sniper', () => {
    expect(damageAt(w('sniper'), 199)).toBe(90);
  });
});

describe('spreadFor', () => {
  it('widens on the move and tightens when aiming', () => {
    const rifle = w('rifle');
    const still = spreadFor(rifle, 0, SPRINT, false);
    expect(spreadFor(rifle, SPRINT, SPRINT, false)).toBeGreaterThan(still * 2);
    expect(spreadFor(rifle, 0, SPRINT, true)).toBeLessThan(still / 2);
  });
});

describe('each gun has its own job', () => {
  /** Damage a magazine-limited burst does in one second at a distance, aimed and standing. */
  const dps = (id: string, distance: number) =>
    damageAt(w(id), distance) * w(id).pellets * (w(id).rpm / 60);

  it('the shotgun wins in a doorway and is useless across a street', () => {
    expect(dps('shotgun', 4)).toBeGreaterThan(dps('smg', 4) * 0.5);
    expect(damageAt(w('shotgun'), 14) * w('shotgun').pellets).toBeLessThan(25);
  });

  it('the SMG keeps its aim on the run; the rifle and sniper do not', () => {
    const onTheRun = (id: string) => spreadFor(w(id), SPRINT, SPRINT, false) / w(id).spread;
    expect(onTheRun('smg')).toBeLessThan(onTheRun('rifle'));
    expect(onTheRun('rifle')).toBeLessThan(onTheRun('sniper'));
  });

  it('the rifle out-damages the SMG at mid range', () => {
    expect(dps('rifle', 40)).toBeGreaterThan(dps('smg', 40));
  });

  it('the sniper is pinpoint only scoped and still, and zooms the most', () => {
    const sniper = w('sniper');
    expect(spreadFor(sniper, 0, SPRINT, true)).toBeLessThan(0.002);
    expect(spreadFor(sniper, 0, SPRINT, false)).toBeGreaterThan(0.02);
    for (const id of WEAPON_IDS) expect(sniper.aimZoom).toBeGreaterThanOrEqual(w(id).aimZoom);
  });
});
