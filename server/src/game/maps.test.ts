import { describe, expect, it } from 'vitest';
import { mapByName, parseMapName } from './maps';

describe('maps', () => {
  it('loads each named map', () => {
    expect(mapByName('heist').id).toBe('heist');
    expect(mapByName('sandbox').id).toBe('sandbox');
    expect(mapByName(undefined).id).toBe('sandbox');
    expect(mapByName('bench').halfSize).toBeGreaterThan(300);
  });
  it('parses env values, falling back to the sandbox', () => {
    expect(parseMapName('heist')).toBe('heist');
    expect(parseMapName('bench')).toBe('bench');
    expect(parseMapName('nonsense')).toBe('sandbox');
    expect(parseMapName(undefined)).toBe('sandbox');
  });
});
