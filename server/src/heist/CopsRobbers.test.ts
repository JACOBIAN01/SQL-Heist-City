import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CITY_DB_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_MODES_SETTINGS,
  PROTOCOL_VERSION,
  applyModeHeist,
  findAnchor,
  mapById,
  modeById,
  type GameMap,
  type TeamMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import type { ChallengeGateway } from './ChallengeGateway';

const city = mapById('city') as GameMap;
const runner = new InProcessSandboxRunner();
const mode = modeById(DEFAULT_MODES_SETTINGS, 'cops-and-robbers');
const heist = applyModeHeist(DEFAULT_HEIST_SETTINGS, mode);
const vault = city.vaults?.[0];
if (!vault) throw new Error('no vault');
const console1 = findAnchor(city, vault.consoleId);
if (!console1) throw new Error('no console');

function setup(players = 5) {
  const gateway: ChallengeGateway = {
    handle: async () => {
      throw new Error('not used');
    },
    playerLeft: () => {},
    city: { run: (job) => runner.run(job), settings: () => DEFAULT_CITY_DB_SETTINGS },
  };
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 30, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...heist,
      caches: { ...heist.caches, enabled: false },
      collectibles: { ...heist.collectibles, enabled: false },
    },
    challenges: gateway,
    seed: 'cops-test',
  });
  const joined = Array.from({ length: players }, (_, i) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, `P${i + 1}`, connection);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  });
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  seconds(20); // past the round countdown
  for (const j of joined) {
    j.player.alive = true;
    j.player.hp = match.maxHp;
  }
  return { match, joined, heist: match.heist, seconds };
}

describe('cops and robbers (34.1)', () => {
  it('is a mode a class can pick, with the AI police and guards off', () => {
    expect(mode.id).toBe('cops-and-robbers');
    expect(heist.copsRobbers.enabled).toBe(true);
    expect(heist.police.enabled).toBe(false);
    expect(DEFAULT_HEIST_SETTINGS.copsRobbers.enabled).toBe(false);
  });

  it('makes every fourth player to join a cop, and tells each their side', () => {
    const { joined } = setup(8);
    const roles = joined.map((j) => (j.player.isCop ? 'cop' : 'robber'));
    expect(roles).toEqual([
      'robber',
      'robber',
      'robber',
      'cop',
      'robber',
      'robber',
      'robber',
      'cop',
    ]);
    const told = joined[3]?.connection.jsonOf('team').at(-1) as unknown as TeamMessage;
    expect(told.role).toBe('cop');
  });

  it('is off in an ordinary room: nobody is a cop', () => {
    const match = new Match({
      map: city,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 10, sandboxDummies: 0 },
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: DEFAULT_HEIST_SETTINGS,
      seed: 'plain',
    });
    for (let i = 0; i < 8; i++) match.join(PROTOCOL_VERSION, `P${i}`, new FakeConnection());
    expect([...match.playerList()].some((p) => p.isCop)).toBe(false);
  });

  it('arms a cop, with armour, and keeps them out of the vaults', () => {
    const { joined, heist: h, match } = setup(4);
    const cop = joined[3]?.player;
    if (!cop) throw new Error('no cop');
    expect(cop.arsenal.has('pistol')).toBe(true);
    expect(cop.armour).toBe(DEFAULT_HEIST_SETTINGS.copsRobbers.copArmour);
    match.teleport(cop, console1.x, console1.y, console1.z);
    h.onJson(cop, JSON.stringify({ t: 'interact', ref: 1, anchor: console1.id }));
    const reply = joined[3]?.connection.jsonOf('interact_result').at(-1) as unknown as {
      result: { action: string };
    };
    expect(reply.result.action).toBe('denied');
  });

  it('puts a cop’s recovered cash straight into their score', () => {
    const { joined, heist: h, match } = setup(4);
    const cop = joined[3]?.player;
    if (!cop) throw new Error('no cop');
    h.loot.add(cop.body.x, cop.body.y, cop.body.z, 7_000);
    match.step();
    expect(cop.banked).toBe(7_000);
    expect(cop.cash).toBe(0);
  });

  it('scores an arrest: a cop who puts a robber down', () => {
    const { joined, match } = setup(4);
    const [robber, cop] = [joined[0]?.player, joined[3]?.player];
    if (!robber || !cop) throw new Error('players');
    const before = cop.banked;
    match.damage(robber, 999, cop);
    expect(cop.banked - before).toBeGreaterThanOrEqual(
      DEFAULT_HEIST_SETTINGS.copsRobbers.arrestPoints,
    );
  });

  it('logs where the robbers have been, never the cops, and keeps it a while', () => {
    const { heist: h, seconds, joined } = setup(4);
    seconds(12);
    const rows = h.cops.trail();
    expect(rows.length).toBeGreaterThan(0);
    const cop = joined[3]?.player;
    expect(rows.every((r) => r.robber !== cop?.id)).toBe(true);
    expect(Math.max(...rows.map((r) => r.ageS))).toBeLessThanOrEqual(
      DEFAULT_HEIST_SETTINGS.copsRobbers.keepSeconds,
    );
    seconds(DEFAULT_HEIST_SETTINGS.copsRobbers.keepSeconds + 10);
    // Old entries drop out when the next sample is taken, so up to one interval past the limit.
    expect(Math.max(...h.cops.trail().map((r) => r.ageS))).toBeLessThanOrEqual(
      DEFAULT_HEIST_SETTINGS.copsRobbers.keepSeconds +
        DEFAULT_HEIST_SETTINGS.copsRobbers.logEverySeconds,
    );
  });

  it('lets a cop find the robbers with SQL on the trail, and nobody else', async () => {
    const { heist: h, seconds, joined, match } = setup(4);
    seconds(12);
    const cop = joined[3]?.player;
    const robber = joined[0]?.player;
    if (!cop || !robber) throw new Error('players');
    // Intel only shows what is within range: stand where the robbers are.
    match.teleport(cop, robber.body.x, 0, robber.body.z);
    const copCatalog = h.intel.catalog(cop);
    const robberCatalog = h.intel.catalog(robber);
    expect(copCatalog.requests.some((r) => r.id === 'trail-recent')).toBe(true);
    expect(copCatalog.tables.some((t) => t.name === 'trail')).toBe(true);
    expect(robberCatalog.requests.some((r) => r.id === 'trail-recent')).toBe(false);
    expect(robberCatalog.tables.some((t) => t.name === 'trail')).toBe(false);
    const ask = (p: typeof cop, sql: string) =>
      h.intel.ask(p, { t: 'city_query', ref: 1, request: 'trail-recent', sql });
    expect((await ask(robber, 'SELECT x, z FROM trail WHERE age_s <= 20')).reason).toBe('unknown');
    const reply = await ask(cop, 'SELECT x, z FROM trail WHERE age_s <= 20');
    expect(reply.ok).toBe(true);
    expect(reply.result?.pins ?? 0).toBeGreaterThan(0);
  });

  it('does not offer the trail in a room that is not cops and robbers', async () => {
    const match = new Match({
      map: city,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 10, sandboxDummies: 0 },
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: DEFAULT_HEIST_SETTINGS,
      seed: 'plain',
    });
    const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    expect(match.heist.intel.catalog(r.player).requests.some((q) => q.team !== undefined)).toBe(
      false,
    );
  });
});
