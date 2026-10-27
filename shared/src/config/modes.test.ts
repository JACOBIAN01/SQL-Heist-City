import { describe, expect, it } from 'vitest';
import { DEFAULT_HEIST_SETTINGS } from './heist';
import {
  DEFAULT_MODES_SETTINGS as S,
  applyModeHeist,
  banksForMode,
  modeById,
  modeHeistProblem,
  modesSettingsSchema,
} from './modes';

const mode = (id: string) => modeById(S, id);

describe('game modes', () => {
  it('ships classic, smash and grab, cops and robbers, and quick draw', () => {
    expect(S.modes.map((m) => [m.id, m.kind])).toEqual([
      ['classic', 'heist'],
      ['smash-and-grab', 'heist'],
      ['cops-and-robbers', 'heist'],
      ['quick-draw', 'duel'],
    ]);
  });

  it('classic changes nothing; smash and grab shortens the round and the vault', () => {
    expect(applyModeHeist(DEFAULT_HEIST_SETTINGS, mode('classic'))).toEqual(DEFAULT_HEIST_SETTINGS);
    const smash = applyModeHeist(DEFAULT_HEIST_SETTINGS, mode('smash-and-grab'));
    expect(smash).toMatchObject({ roundMinutes: 5, locksPerVault: 2, overtimeSeconds: 20 });
    // What the mode does not name is left as the admin set it.
    expect(smash.killBonus).toBe(DEFAULT_HEIST_SETTINGS.killBonus);
    const custom = { ...DEFAULT_HEIST_SETTINGS, killBonus: 123 };
    expect(applyModeHeist(custom, mode('smash-and-grab')).killBonus).toBe(123);
  });

  it('drops a change that does not fit rather than applying half of it', () => {
    const bad = { ...mode('classic'), heist: { locksPerVault: 99, roundMinutes: 3 } };
    expect(applyModeHeist(DEFAULT_HEIST_SETTINGS, bad)).toEqual(DEFAULT_HEIST_SETTINGS);
  });

  it('limits the banks to the lowest ones the class has open', () => {
    expect(banksForMode([3, 1, 5], mode('classic'))).toEqual([1, 3, 5]);
    expect(banksForMode([3, 1, 5], mode('smash-and-grab'))).toEqual([1]);
    expect(banksForMode([4, 5], mode('smash-and-grab'))).toEqual([4]);
    expect(banksForMode([1, 2], mode('quick-draw'))).toEqual([]);
  });

  it('plays classic when a class asks for a mode that no longer exists', () => {
    expect(modeById(S, 'gone').id).toBe('classic');
  });

  it('refuses mode lists that are broken', () => {
    const base = S.modes[0];
    const ok = (modes: unknown) => modesSettingsSchema.safeParse({ modes }).success;
    expect(ok([base])).toBe(true);
    expect(ok([{ ...base, id: 'other' }])).toBe(false); // no classic
    expect(ok([base, base])).toBe(false); // twins
    expect(ok([{ ...base, heist: { notASetting: 1 } }])).toBe(false);
    expect(ok([{ ...base, heist: { locksPerVault: 50 } }])).toBe(false);
    expect(modeHeistProblem({ heist: { roundMinutes: 8 } })).toBeUndefined();
  });
});
