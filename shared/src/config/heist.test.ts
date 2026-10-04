import { describe, expect, it } from 'vitest';
import { DEFAULT_HEIST_SETTINGS, carrySpeedScale, heistSettingsSchema } from './heist';

describe('carrySpeedScale', () => {
  const s = DEFAULT_HEIST_SETTINGS;
  it('is 1 with empty pockets', () => expect(carrySpeedScale(0, s)).toBe(1));
  it('loses 10% per $100k', () => {
    expect(carrySpeedScale(100_000, s)).toBeCloseTo(0.9);
    expect(carrySpeedScale(50_000, s)).toBeCloseTo(0.95);
  });
  it('stops slowing at the cap', () => {
    expect(carrySpeedScale(300_000, s)).toBeCloseTo(0.7);
    expect(carrySpeedScale(5_000_000, s)).toBeCloseTo(0.7);
  });
  it('follows retuned settings', () => {
    const tuned = heistSettingsSchema.parse({ carrySlowPer100k: 0.2, carrySlowMax: 0.5 });
    expect(carrySpeedScale(100_000, tuned)).toBeCloseTo(0.8);
    expect(carrySpeedScale(900_000, tuned)).toBeCloseTo(0.5);
  });
});

describe('heist defaults', () => {
  it('give every bank tier a vault of loot, rising with the tier', () => {
    const loot = [1, 2, 3, 4, 5].map((t) => DEFAULT_HEIST_SETTINGS.vaultLootByTier[String(t)] ?? 0);
    expect(loot).toEqual([50_000, 100_000, 200_000, 400_000, 800_000]);
  });
});
