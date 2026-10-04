import { describe, expect, it } from 'vitest';
import { mapByName, parseMapName } from './maps';

describe('maps', () => {
  it('loads each named map', () => {
    expect(mapByName('heist').id).toBe('heist');
    expect(mapByName('sandbox').id).toBe('sandbox');
    expect(mapByName(undefined).id).toBe('sandbox');
    expect(mapByName('bench').halfSize).toBeGreaterThan(300);
    expect(mapByName('city').id).toBe('city');
    expect(mapByName('city:abc').city?.settings.seed).toBe('abc');
  });
  it('parses env values, falling back to the sandbox', () => {
    expect(parseMapName('heist')).toBe('heist');
    expect(parseMapName('bench')).toBe('bench');
    expect(parseMapName('city')).toBe('city');
    expect(parseMapName('city:class-7')).toBe('city:class-7');
    expect(parseMapName('city:bad seed')).toBe('sandbox');
    expect(parseMapName('nonsense')).toBe('sandbox');
    expect(parseMapName(undefined)).toBe('sandbox');
  });
});
