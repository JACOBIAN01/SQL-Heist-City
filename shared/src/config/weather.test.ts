import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATMOSPHERE_SETTINGS as S,
  atmosphereSettingsSchema,
  spellKind,
  weatherAt,
} from './atmosphere';

const MIN = 60_000;

describe('weather', () => {
  it('starts clear, and every player gets the same sky from the same seed and clock', () => {
    expect(weatherAt(0, 'a', S)).toEqual({ rain: 0, fog: 0, kind: 'clear' });
    expect(weatherAt(7 * MIN, 'a', S)).toEqual(weatherAt(7 * MIN, 'a', S));
  });

  it('cycles through every kind over a long match, roughly by the weights', () => {
    const counts = { clear: 0, fog: 0, rain: 0, storm: 0 };
    for (let i = 1; i <= 2000; i++) counts[spellKind('seed', i, S)]++;
    expect(counts.fog).toBeGreaterThan(100);
    expect(counts.storm).toBeGreaterThan(100);
    expect(counts.clear).toBeGreaterThan(counts.rain);
    expect(counts.rain).toBeGreaterThan(counts.fog);
  });

  it('blends between spells rather than jumping, and stays within 0..1', () => {
    for (let ms = 0; ms < 60 * MIN; ms += 5000) {
      const w = weatherAt(ms, 'x', S);
      expect(w.rain).toBeGreaterThanOrEqual(0);
      expect(w.rain).toBeLessThanOrEqual(1);
      const next = weatherAt(ms + 1000, 'x', S);
      expect(Math.abs(next.rain - w.rain)).toBeLessThan(0.2);
      expect(Math.abs(next.fog - w.fog)).toBeLessThan(0.2);
    }
  });

  it('is always clear when switched off or when only clear has a weight', () => {
    const off = atmosphereSettingsSchema.parse({ weather: { enabled: false } });
    expect(weatherAt(20 * MIN, 'x', off).kind).toBe('clear');
    const only = atmosphereSettingsSchema.parse({
      weather: { weights: { clear: 1, fog: 0, rain: 0, storm: 0 } },
    });
    for (let i = 0; i < 50; i++) expect(spellKind('x', i, only)).toBe('clear');
  });
});
