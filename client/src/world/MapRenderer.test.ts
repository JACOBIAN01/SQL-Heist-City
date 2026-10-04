import { describe, expect, it } from 'vitest';
import { HEIST_MAP } from '@heist/shared';
import { buildMapObject, setClosedDoors } from './MapRenderer';

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
