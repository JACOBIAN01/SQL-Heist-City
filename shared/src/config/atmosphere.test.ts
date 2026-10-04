import { describe, expect, it } from 'vitest';
import { atmosphereSettingsSchema, DEFAULT_ATMOSPHERE_SETTINGS, hourAt } from './atmosphere';

describe('hourAt', () => {
  const s = DEFAULT_ATMOSPHERE_SETTINGS;
  it('starts at the start hour and runs a full day in dayMinutes', () => {
    expect(hourAt(0, s)).toBe(9);
    expect(hourAt(15 * 60_000, s)).toBeCloseTo(21); // half a 30-minute day: 12 hours later
    expect(hourAt(30 * 60_000, s)).toBeCloseTo(9);
  });

  it('wraps past midnight and never goes negative', () => {
    expect(hourAt(20 * 60_000, s)).toBeCloseTo(1);
    expect(hourAt(-60_000, { dayMinutes: 24, startHour: 0 })).toBeCloseTo(23);
  });

  it('rejects impossible settings', () => {
    expect(() => atmosphereSettingsSchema.parse({ dayMinutes: 0 })).toThrow();
    expect(() => atmosphereSettingsSchema.parse({ startHour: 25 })).toThrow();
  });
});
