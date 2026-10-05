import { describe, expect, it } from 'vitest';
import { DEFAULT_WEAPONS, weaponSpecSchema } from '@heist/shared';
import { WeaponTable } from './WeaponTable';

describe('WeaponTable', () => {
  it('uses the shared defaults until the server sends its own', () => {
    const table = new WeaponTable();
    expect(table.get('rifle')).toBe(DEFAULT_WEAPONS.rifle);
    expect(table.get(undefined)).toBeUndefined();
    const retuned = weaponSpecSchema.parse({ damage: 40, rpm: 300, range: 90, magSize: 20 });
    table.set({ ...DEFAULT_WEAPONS, rifle: retuned });
    expect(table.get('rifle')?.magSize).toBe(20);
  });
});
