import { describe, expect, it } from 'vitest';
import { WEAPON_IDS } from '@heist/shared';
import { createGun } from './GunModel';

describe('createGun', () => {
  it('has a model for every gun in the game, named for it', () => {
    for (const id of WEAPON_IDS) expect(createGun(id)?.name).toBe(`gun-${id}`);
  });
  it('has none for an unknown id', () => expect(createGun('laser')).toBeUndefined());
  it('is longer for a rifle than a pistol', () => {
    const len = (id: string) => {
      const z = (createGun(id)?.children ?? []).map((m) => m.position.z);
      return Math.max(...z) - Math.min(...z);
    };
    expect(len('rifle')).toBeGreaterThan(len('pistol'));
  });
});
