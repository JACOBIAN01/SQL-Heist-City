import { describe, expect, it } from 'vitest';
import { HEIST_MAP, type MapVault } from '@heist/shared';
import { Vault } from './Vault';
import { VaultRegistry } from './VaultRegistry';

const spec = HEIST_MAP.vaults?.[0] as MapVault;

describe('Vault', () => {
  it('opens locks strictly in order and opens after the last one', () => {
    const v = new Vault(spec, 3);
    expect(v.nextLock).toBe(1);
    expect(v.openLock(2)).toBe('out_of_order');
    expect(v.openLock(1)).toBe('opened');
    expect(v.openLock(1)).toBe('already_open'); // a second solver of the same lock
    expect(v.openLock(2)).toBe('opened');
    expect(v.isOpen).toBe(false);
    expect(v.openLock(3)).toBe('opened');
    expect(v.isOpen).toBe(true);
    expect(v.nextLock).toBeUndefined();
    expect(v.openLock(3)).toBe('already_open');
  });

  it('reports its progress for clients', () => {
    const v = new Vault(spec, 3);
    v.openLock(1);
    expect(v.view()).toEqual({ id: 'bank-1:vault', tier: 1, locks: 3, opened: 1 });
  });

  it('honours a configured lock count', () => {
    const v = new Vault(spec, 1);
    v.openLock(1);
    expect(v.isOpen).toBe(true);
  });
});

describe('VaultRegistry', () => {
  it('builds a vault per map vault and finds it by console', () => {
    const r = new VaultRegistry(HEIST_MAP, 3);
    expect(r.get('bank-1:vault')?.lockCount).toBe(3);
    expect(r.byConsole('bank-1:vault:console')?.spec.id).toBe('bank-1:vault');
    expect(r.byConsole('nope')).toBeUndefined();
  });

  it('lists the doors of vaults that are still closed', () => {
    const r = new VaultRegistry(HEIST_MAP, 1);
    expect(r.closedDoorIds()).toEqual(['bank-1:vault:door']);
    r.get('bank-1:vault')?.openLock(1);
    expect(r.closedDoorIds()).toEqual([]);
  });
});
