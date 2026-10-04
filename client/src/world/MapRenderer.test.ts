import { describe, expect, it } from 'vitest';
import { HEIST_MAP, mapById } from '@heist/shared';
import { buildMapObject, hideKitCovered, setClosedDoors } from './MapRenderer';

describe('vault doors in the map object', () => {
  const root = buildMapObject(HEIST_MAP);
  const door = () => root.getObjectByName('door-bank-1:vault:door');

  it('has a mesh per door and a pad per anchor', () => {
    expect(door()).toBeDefined();
    expect(root.getObjectByName('anchor-bank-1:lift:0')).toBeDefined();
  });

  it('shows closed doors and hides open ones', () => {
    setClosedDoors(root, new Set());
    expect(door()?.visible).toBe(false);
    setClosedDoors(root, new Set(['bank-1:vault:door']));
    expect(door()?.visible).toBe(true);
  });
});

describe('city boxes under the kit', () => {
  it('hides shells, kerbs, the city wall and the plain ground once the kit draws them, keeping bank walls', () => {
    const city = mapById('city');
    if (!city) throw new Error('no city');
    const root = buildMapObject(city);
    hideKitCovered(root);
    for (const name of ['map-ground', 'map-shell', 'map-kerb', 'map-wall'])
      expect(root.getObjectByName(name)?.visible).toBe(false);
    expect(root.getObjectByName('map-building')?.visible).toBe(true);
    expect(root.getObjectByName('door-bank-1:vault:door')?.visible).toBe(true);
  });
});
