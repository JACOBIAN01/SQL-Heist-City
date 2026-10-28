import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type HeistSettings,
  type InsideMessage,
} from '@heist/shared';
import { tiersForReward } from '../challenges/tiers';
import { StaticSettings } from '../config/SettingsReader';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const vault = city.vaults?.[0];
if (!vault) throw new Error('no vault');
const I = DEFAULT_HEIST_SETTINGS.insideMan;

function setup(over: Partial<HeistSettings['insideMan']> = {}) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      insideMan: { ...I, chance: 1, ...over },
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
      approach: { ...DEFAULT_HEIST_SETTINGS.approach, loudBonus: 0 },
    },
    seed: 'inside-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  r.player.alive = true;
  r.player.hp = match.maxHp;
  const calls = () => connection.jsonOf('inside').map((m) => m as unknown as InsideMessage);
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  return { match, player: r.player, heist: match.heist, calls, seconds };
}

describe('the inside man (34.3)', () => {
  it('rings after a lock is cracked, with a line and a time limit', () => {
    const { heist, player, calls } = setup();
    heist.openLock(vault.id, 1, player);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ status: 'call', bank: vault.bank, seconds: I.seconds });
    expect(I.lines).toContain(calls()[0]?.text);
  });

  it('does not ring after the last lock, or while a call is open, or when switched off', () => {
    const { heist, player, calls } = setup();
    const locks = heist.vaults.get(vault.id)?.lockCount ?? 0;
    for (let k = 1; k <= locks; k++) heist.openLock(vault.id, k, player);
    expect(calls()).toHaveLength(1); // one for the first lock, none for the rest
    const off = setup({ enabled: false });
    off.heist.openLock(vault.id, 1, off.player);
    expect(off.calls()).toHaveLength(0);
    const never = setup({ chance: 0 });
    never.heist.openLock(vault.id, 1, never.player);
    expect(never.calls()).toHaveLength(0);
  });

  it('asks for a fix-the-query question, a tier matching the bank', () => {
    const settings = new StaticSettings();
    expect(settings.challengeSettings().taskKinds['inside']).toEqual(['fix']);
    expect(tiersForReward(`inside:${vault.bank}`, settings)).toEqual({ min: 1, max: 1 });
    expect(tiersForReward('inside:bank-4', settings)).toEqual({ min: 3, max: 4 });
  });

  it('can be answered only while the call is live, and only for that bank', () => {
    const { heist, player, seconds } = setup();
    const rule = heist.tasks.find(`inside:${vault.bank}`);
    expect(rule?.check(player, `inside:${vault.bank}`, undefined)).toBe('not_allowed');
    heist.openLock(vault.id, 1, player);
    expect(rule?.check(player, `inside:${vault.bank}`, undefined)).toBeUndefined();
    expect(rule?.check(player, 'inside:bank-5', undefined)).toBe('not_allowed');
    seconds(I.seconds + 2);
    expect(rule?.check(player, `inside:${vault.bank}`, undefined)).toBe('not_allowed');
  });

  it('pays the tip and calms the bank’s guards when the query is fixed', () => {
    const { heist, player, calls } = setup();
    heist.openLock(vault.id, 1, player); // an alarm: the guards are on alert
    heist.tasks.find(`inside:${vault.bank}`)?.grant(player, `inside:${vault.bank}`, null);
    expect(player.cash).toBe(I.reward);
    expect(calls().at(-1)?.status).toBe('done');
    expect(heist.inside.callOf(player)).toBeUndefined();
    // Nothing more to claim.
    heist.tasks.find(`inside:${vault.bank}`)?.grant(player, `inside:${vault.bank}`, null);
    expect(player.cash).toBe(I.reward);
  });

  it('lets an unanswered call lapse, with nothing paid', () => {
    const { player, calls, heist, seconds } = setup();
    heist.openLock(vault.id, 1, player);
    seconds(I.seconds + 2);
    expect(calls().at(-1)?.status).toBe('missed');
    expect(player.cash).toBe(0);
  });
});
