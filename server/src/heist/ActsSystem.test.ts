import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type ActsMessage,
  type GameMap,
  type IntelGuardsMessage,
  type MapAnchor,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const A = DEFAULT_HEIST_SETTINGS.acts;
const vault = city.vaults?.[0];
if (!vault) throw new Error('no vault');
const bank = vault.bank;
const foundTerminal = city.anchors?.find((a) => a.kind === 'intel_terminal' && a.bank === bank);
if (!foundTerminal) throw new Error('no terminal');
const terminal: MapAnchor = foundTerminal;

function setup() {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
      // No guards or loud bonus muddying the sums.
      guards: { ...DEFAULT_HEIST_SETTINGS.guards, perBankTier: {} },
      approach: { ...DEFAULT_HEIST_SETTINGS.approach, loudBonus: 0 },
    },
    seed: 'acts-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  match.teleport(player, terminal.x, 0, terminal.z);
  for (let i = 0; i < 20 * match.tickRate; i++) match.step(); // past the round countdown
  player.alive = true;
  player.hp = match.maxHp;
  match.teleport(player, terminal.x, 0, terminal.z);
  const last = () => connection.jsonOf('acts').at(-1) as unknown as ActsMessage | undefined;
  const intelGuards = () =>
    connection.jsonOf('intel_guards').at(-1) as unknown as IntelGuardsMessage | undefined;
  const solve = () => {
    const rule = match.heist.tasks.find(`intel:${bank}`);
    expect(rule?.check(player, `intel:${bank}`, bank)).toBeUndefined();
    rule?.grant(player, `intel:${bank}`, bank);
  };
  return { match, player, heist: match.heist, last, intelGuards, solve };
}

describe('a heist in three acts (31.1)', () => {
  it('put an intel terminal outside every bank', () => {
    const banks = new Set(city.vaults?.map((v) => v.bank));
    const terminals = new Set(
      city.anchors?.filter((a) => a.kind === 'intel_terminal').map((a) => a.bank),
    );
    expect(terminals).toEqual(banks);
  });

  it('open an intel question at the terminal until the intel is full', () => {
    const { match, player, heist, solve } = setup();
    expect(heist.interactions.use(player, terminal.id)).toEqual({
      action: 'open_task',
      rewardKey: `intel:${bank}`,
      target: bank,
    });
    for (let i = 0; i < A.intelMax; i++) solve();
    expect(heist.acts.intelOf(player, bank)).toBe(A.intelMax);
    for (let i = 0; i < 2 * match.tickRate; i++) match.step();
    expect(heist.interactions.use(player, terminal.id)).toEqual({
      action: 'denied',
      reason: 'intel_full',
    });
    expect(heist.tasks.find(`intel:${bank}`)?.check(player, `intel:${bank}`, bank)).toBe(
      'not_allowed',
    );
  });

  it('ask a question matched to the bank, and refuse unknown banks', () => {
    const { heist, player } = setup();
    expect(heist.tasks.find('intel:bank-9')).toBeUndefined();
    expect(heist.tasks.find(`intel:${bank}`)?.check(player, 'intel:bank-3', bank)).toBeUndefined();
  });

  it('tell the player they are in act one after gathering intel', () => {
    const { player, heist, last, solve } = setup();
    solve();
    expect(last()).toMatchObject({ act: 'setup', bank, intel: 1, intelMax: A.intelMax });
    expect(heist.acts.runOf(player)?.act).toBe('setup');
  });

  it('move to act two on a cracked lock, act three on carrying the take, and complete on banking', () => {
    const { match, player, heist, last } = setup();
    heist.openLock(vault.id, 1, player);
    expect(last()).toMatchObject({ act: 'heist' });
    const locks = heist.vaults.get(vault.id)?.lockCount ?? 0;
    for (let k = 2; k <= locks; k++) heist.openLock(vault.id, k, player);
    const spot = vault.loot[0];
    if (!spot) throw new Error('no loot spot');
    match.teleport(player, spot.x, spot.y, spot.z);
    match.step();
    expect(last()?.act).toBe('getaway');
    expect(last()?.take).toBeGreaterThan(0);
    const carried = last()?.take ?? 0;
    heist.events.publish({ type: 'banked', player, amount: carried });
    expect(last()).toMatchObject({ act: 'complete', take: carried });
    expect(heist.acts.runOf(player)).toBeUndefined();
  });

  it('end the run when the player dies', () => {
    const { match, player, heist, last } = setup();
    heist.openLock(vault.id, 1, player);
    match.damage(player, 999, player);
    expect(last()?.act).toBe('none');
    expect(heist.acts.runOf(player)).toBeUndefined();
  });

  it('level 1 shows the bank’s guards on the map, level 2 shortens the alarm, level 3 adds loot', () => {
    const { heist, player, solve } = setup();
    expect(heist.acts.alertScale(player, bank)).toBe(1);
    expect(heist.acts.lootBonus(player, bank)).toBe(0);
    solve();
    solve();
    expect(heist.acts.alertScale(player, bank)).toBe(A.alertScale);
    expect(heist.acts.lootBonus(player, bank)).toBe(0);
    solve();
    expect(heist.acts.lootBonus(player, bank)).toBe(A.lootBonus);
  });

  it('pay a bigger vault with full intel', () => {
    const plain = setup();
    const spy = setup();
    for (let i = 0; i < A.intelMax; i++) spy.solve();
    const take = (s: ReturnType<typeof setup>) => {
      const before = s.heist.loot.all().reduce((n, b) => n + b.amount, 0);
      const v = s.heist.vaults.get(vault.id);
      for (let k = 1; k <= (v?.lockCount ?? 0); k++) s.heist.openLock(vault.id, k, s.player);
      return s.heist.loot.all().reduce((n, b) => n + b.amount, 0) - before;
    };
    const a = take(plain);
    const b = take(spy);
    expect(b).toBe(Math.round((a / 1) * (1 + A.lootBonus)));
  });

  it('are off when switched off', () => {
    const match = new Match({
      map: city,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: {
        ...DEFAULT_HEIST_SETTINGS,
        acts: { ...DEFAULT_HEIST_SETTINGS.acts, enabled: false },
      },
      seed: 'off',
    });
    const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    match.teleport(r.player, terminal.x, 0, terminal.z);
    expect(match.heist.interactions.use(r.player, terminal.id)).toMatchObject({ action: 'denied' });
  });
});
