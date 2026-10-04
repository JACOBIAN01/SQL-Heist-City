import { describe, expect, it } from 'vitest';
import { buildTaskOptions, type TaskContext } from './taskOptions';

const ctx = (over: Partial<TaskContext> = {}): TaskContext => ({
  alive: true,
  hp: 40,
  maxHp: 100,
  owned: [],
  weapon: undefined,
  ammo: 0,
  magSize: 0,
  ...over,
});
const find = (tasks: ReturnType<typeof buildTaskOptions>, key: string) =>
  tasks.find((t) => t.key === key);

describe('buildTaskOptions', () => {
  it('offers every heal when hurt, and every gun when unarmed', () => {
    const tasks = buildTaskOptions(ctx());
    for (const key of ['heal:small', 'heal:medium', 'heal:full', 'gun:pistol', 'gun:sniper'])
      expect(find(tasks, key)?.disabled).toBeUndefined();
    expect(tasks.map((t) => t.group)).toEqual(
      expect.arrayContaining(['Heal', 'Ammo', 'Gun', 'Vault']),
    );
  });

  it('greys out heals at full health', () => {
    const tasks = buildTaskOptions(ctx({ hp: 100 }));
    expect(find(tasks, 'heal:small')?.disabled).toBe('Full health');
  });

  it('greys out guns you already own and offers ammo only for a gun that is not full', () => {
    const owned = buildTaskOptions(
      ctx({ owned: ['pistol'], weapon: 'pistol', ammo: 5, magSize: 12 }),
    );
    expect(find(owned, 'gun:pistol')?.disabled).toBe('You have it');
    expect(find(owned, 'gun:rifle')?.disabled).toBeUndefined();
    expect(find(owned, 'ammo:refill')?.disabled).toBeUndefined();
    const full = buildTaskOptions(
      ctx({ owned: ['pistol'], weapon: 'pistol', ammo: 12, magSize: 12 }),
    );
    expect(find(full, 'ammo:refill')?.disabled).toBe('Magazine full');
    expect(find(buildTaskOptions(ctx()), 'ammo:refill')?.disabled).toBe('No gun in hand');
  });

  it('offers the next lock of a vault in reach, with the vault as target', () => {
    const tasks = buildTaskOptions(
      ctx({ vault: { id: 'bank-1:vault', tier: 1, locks: 3, opened: 1 } }),
    );
    expect(find(tasks, 'vault:bank-1:lock-2')).toMatchObject({
      label: 'Lock 2 of 3',
      target: 'bank-1:vault',
    });
    expect(find(tasks, 'vault:bank-1:lock-2')?.disabled).toBeUndefined();
  });

  it('explains the vault entry when out of reach or already open', () => {
    expect(find(buildTaskOptions(ctx()), 'vault:none')?.disabled).toBe('Stand at a vault console');
    const open = buildTaskOptions(ctx({ vault: { id: 'v', tier: 1, locks: 3, opened: 3 } }));
    expect(find(open, 'vault:none')?.disabled).toBe('Already open');
  });

  it('disables everything for a dead player', () => {
    const tasks = buildTaskOptions(
      ctx({ alive: false, vault: { id: 'v', tier: 1, locks: 3, opened: 0 } }),
    );
    expect(tasks.every((t) => t.disabled === 'You are dead' || t.key === 'vault:none')).toBe(true);
  });
});
