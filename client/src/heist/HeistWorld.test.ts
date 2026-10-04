import { describe, expect, it } from 'vitest';
import { HEIST_MAP, TEST_MAP } from '@heist/shared';
import { HeistWorld } from './HeistWorld';

const vault = (opened: number) => ({ id: 'bank-1:vault', tier: 1, locks: 3, opened });

describe('HeistWorld', () => {
  it('starts with every vault door closed', () => {
    const world = new HeistWorld(HEIST_MAP);
    expect(world.map.boxes).toHaveLength(HEIST_MAP.boxes.length + 1);
  });

  it('keeps the door while locks remain and drops it when the vault opens', () => {
    const world = new HeistWorld(HEIST_MAP);
    world.applyVaults([vault(2)]);
    expect(world.map.boxes).toHaveLength(HEIST_MAP.boxes.length + 1);
    world.applyVaults([vault(3)]);
    expect(world.map).toBe(HEIST_MAP);
  });

  it('tells listeners the new map and which doors are closed', () => {
    const world = new HeistWorld(HEIST_MAP);
    const seen: string[][] = [];
    world.onChange((_map, closed) => seen.push([...closed]));
    world.applyVaults([vault(3)]);
    expect(seen).toEqual([['bank-1:vault:door'], []]);
  });

  it('is a no-op for maps without vaults', () => {
    const world = new HeistWorld(TEST_MAP);
    world.applyVaults([]);
    expect(world.map).toBe(TEST_MAP);
  });

  it('exposes the vault progress', () => {
    const world = new HeistWorld(HEIST_MAP);
    world.applyVaults([vault(1)]);
    expect(world.vaults[0]?.opened).toBe(1);
  });
});
