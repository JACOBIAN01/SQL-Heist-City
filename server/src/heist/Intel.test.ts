import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CITY_DB_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  findAnchor,
  mapById,
  type CityDbSettings,
  type CityResultMessage,
  type GameMap,
  type IntelPinsMessage,
  type MapAnchor,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import type { ChallengeGateway } from './ChallengeGateway';

const city = mapById('city') as GameMap;
const vault = city.vaults?.[0];
if (!vault) throw new Error('no vault');
const foundConsole = findAnchor(city, vault.consoleId);
if (!foundConsole) throw new Error('no console');
const console1: MapAnchor = foundConsole;
const runner = new InProcessSandboxRunner();

function setup(over: Partial<CityDbSettings> = {}, near = true) {
  const cityDb: CityDbSettings = { ...DEFAULT_CITY_DB_SETTINGS, ...over };
  const gateway: ChallengeGateway = {
    handle: async () => {
      throw new Error('not used');
    },
    playerLeft: () => {},
    city: { run: (job) => runner.run(job), settings: () => cityDb },
  };
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
    },
    challenges: gateway,
    seed: 'intel-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const where = near ? { x: console1.x, z: console1.z + 5 } : { x: 0, z: 0 };
  match.teleport(player, where.x, near ? console1.y : 0, where.z);
  for (let i = 0; i < 20 * match.tickRate; i++) match.step(); // past the round countdown; the guards are placed
  player.alive = true;
  player.hp = match.maxHp;
  match.teleport(player, where.x, near ? console1.y : 0, where.z);
  let ref = 0;
  const ask = (request: string, sql: string) =>
    match.heist.intel.ask(player, { t: 'city_query', ref: ++ref, request, sql });
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  const pins = () =>
    (connection.jsonOf('intel_pins').at(-1) as unknown as IntelPinsMessage | undefined)?.pins ?? [];
  return { match, player, heist: match.heist, ask, seconds, pins, connection };
}

const ok = (r: CityResultMessage) => r.ok;

describe('the city database (33.1)', () => {
  it('mirrors the world in eight tables, from the match’s own state', async () => {
    const { heist } = setup();
    const data = heist.cityDb.snapshot();
    expect([...data.tables.keys()].sort()).toEqual(
      ['banks', 'cameras', 'cash_drops', 'doors', 'guards', 'police', 'trail', 'wanted'].sort(),
    );
    const guards = data.tables.get('guards');
    expect(guards?.rows.length).toBe(heist.guards.snapshot().length);
    expect(guards?.rows.length).toBeGreaterThan(0);
    expect(data.tables.get('banks')?.rows).toHaveLength(5);
    expect(data.tables.get('doors')?.rows.every((r) => r[2] === 1)).toBe(true); // all locked
    expect(data.tables.get('cameras')?.rows.length).toBe(heist.cameras.cameras.length);
  });

  it('follows the world as it changes, without being kept up to date by hand', async () => {
    const { heist, player } = setup();
    const before = heist.cityDb.snapshot().tables.get('cash_drops')?.rows.length ?? 0;
    heist.loot.add(10, 0, 20, 9_000);
    const after = heist.cityDb.snapshot().tables.get('cash_drops');
    expect(after?.rows.length).toBe(before + 1);
    expect(after?.rows.some((r) => r[3] === 9_000)).toBe(true);
    heist.setCash(player, 1_000_000);
    heist.bounties.onTick();
    expect(
      heist.cityDb
        .snapshot()
        .tables.get('wanted')
        ?.rows.map((r) => r[1]),
    ).toContain('P');
  });

  it('is cheap: a snapshot of a full city takes a few milliseconds', async () => {
    const { heist } = setup();
    const t = performance.now();
    for (let i = 0; i < 20; i++) heist.cityDb.snapshot();
    expect((performance.now() - t) / 20).toBeLessThan(5);
  });
});

describe('intel queries (33.2, 33.3)', () => {
  it('never tells a student the answers', async () => {
    const { heist } = setup();
    const text = JSON.stringify(heist.intel.catalog());
    expect(text).not.toContain('reference');
    expect(text).not.toContain('SELECT x, z FROM guards');
    expect(heist.intel.catalog().requests.length).toBeGreaterThan(5);
  });

  it('shows a right query’s rows on the map', async () => {
    const { ask, pins, heist, player } = setup();
    const reply = await ask('guards-all', 'SELECT x, z FROM guards');
    expect(ok(reply)).toBe(true);
    expect(reply.result?.kind).toBe('intel');
    expect(pins().length).toBeGreaterThan(0);
    expect(heist.intel.pinsOf(player).length).toBe(reply.result?.pins);
  });

  it('accepts any right way of asking, not just the model one', async () => {
    const { ask, seconds } = setup();
    const reply = await ask(
      'guards-all',
      'select g.z as zz, g.x as xx from guards g order by g.id desc',
    );
    // Column order differs from the model answer (x, z), so this is a different result.
    expect(ok(reply)).toBe(false);
    seconds(3);
    const same = await ask(
      'guards-all',
      'SELECT g.x AS a, g.z AS b FROM guards AS g ORDER BY g.id DESC',
    );
    expect(ok(same)).toBe(true);
  });

  it('refuses a wrong query with a hint about its shape, and shows nothing', async () => {
    const { ask, pins } = setup();
    const reply = await ask('guards-bank-3', 'SELECT x, z FROM guards');
    expect(reply).toMatchObject({ ok: false, reason: 'wrong' });
    expect(reply.feedback?.message.length).toBeGreaterThan(5);
    expect(pins()).toHaveLength(0);
  });

  it('reports a mistake in the SQL, not a crash', async () => {
    const { ask } = setup();
    const reply = await ask('guards-all', 'SELEC x FROM guards');
    expect(reply).toMatchObject({ ok: false, reason: 'error' });
    expect(reply.feedback).toBeDefined();
  });

  it('lets intel run out', async () => {
    const { ask, pins, seconds, heist, player } = setup();
    await ask('guards-all', 'SELECT x, z FROM guards');
    expect(pins().length).toBeGreaterThan(0);
    seconds(DEFAULT_CITY_DB_SETTINGS.intelSeconds['1'] ?? 20);
    seconds(2);
    expect(heist.intel.pinsOf(player)).toHaveLength(0);
    expect(pins()).toHaveLength(0);
  });

  it('keeps better intel longer: a harder request is worth more time', async () => {
    const lifetime = async (request: string, sql: string) => {
      const { ask, heist, player, match } = setup();
      heist.loot.add(player.body.x + 3, player.body.y, player.body.z, 9_000);
      const reply = await ask(request, sql);
      expect(ok(reply)).toBe(true);
      const pin = heist.intel.pinsOf(player)[0];
      return (pin?.expiresTick ?? 0) - match.tick;
    };
    const easy = await lifetime('cash-all', 'SELECT x, z FROM cash_drops');
    const harder = await lifetime(
      'cash-big',
      'SELECT x, z, amount FROM cash_drops WHERE amount > 5000',
    );
    expect(easy).toBeGreaterThan(0);
    expect(harder).toBeGreaterThan(easy);
  });

  it('labels pins from a joined query with the name it returned', async () => {
    const { ask, heist, player, match, pins } = setup();
    heist.setCash(player, 1_000_000);
    heist.bounties.onTick();
    heist.police.crime(player, 'kill');
    for (let i = 0; i < 3 * match.tickRate; i++) match.step();
    const reply = await ask(
      'police-chasing',
      "SELECT p.x, p.z, w.name FROM police p JOIN wanted w ON w.id = p.target WHERE p.role = 'chase'",
    );
    expect(ok(reply)).toBe(true);
    if ((reply.result?.pins ?? 0) > 0) expect(pins()[0]?.label).toBe('P');
  });

  it('shows only what is within range, not the whole city', async () => {
    const { ask, heist, player } = setup({ rangeMeters: 5 }, true);
    const total = heist.guards.snapshot().length;
    const reply = await ask('guards-all', 'SELECT x, z FROM guards');
    expect(ok(reply)).toBe(true);
    expect(reply.result?.pins ?? 0).toBeLessThan(total);
    void player;
  });

  it('makes a player wait between tries, and between asks of the same request', async () => {
    const { ask, seconds } = setup();
    expect((await ask('guards-all', 'SELECT x, z FROM guards')).ok).toBe(true);
    expect(await ask('guards-all', 'SELECT x, z FROM guards')).toMatchObject({
      reason: 'cooldown',
    });
    seconds(3);
    expect(await ask('guards-all', 'SELECT x, z FROM guards')).toMatchObject({
      reason: 'cooldown',
    }); // past the gap between tries, still in the request's own cooldown
    seconds(DEFAULT_CITY_DB_SETTINGS.cooldownSeconds.intel);
    expect((await ask('guards-all', 'SELECT x, z FROM guards')).ok).toBe(true);
  });

  it('caps how many pins one player holds', async () => {
    const { ask, pins, seconds } = setup({ maxPins: 3 });
    await ask('guards-all', 'SELECT x, z FROM guards');
    seconds(3);
    await ask('cash-all', 'SELECT x, z FROM cash_drops');
    expect(pins().length).toBeLessThanOrEqual(3);
  });

  it('says no to the unknown, the dead and the disabled', async () => {
    const { ask, player, match } = setup();
    expect(await ask('no-such-request', 'SELECT 1')).toMatchObject({ reason: 'unknown' });
    match.damage(player, 999, player);
    expect(await ask('guards-all', 'SELECT x, z FROM guards')).toMatchObject({ reason: 'dead' });
    const off = setup({ enabled: false });
    expect(await off.ask('guards-all', 'SELECT x, z FROM guards')).toMatchObject({
      reason: 'not_available',
    });
    expect(off.heist.intel.catalog().requests).toHaveLength(0);
  });

  it('cannot be used to change the game: a write is refused, and a query runs on a copy', async () => {
    const { ask, heist } = setup();
    const before = heist.guards.snapshot().length;
    const reply = await ask('guards-all', 'DELETE FROM guards');
    expect(reply.ok).toBe(false);
    expect(heist.guards.snapshot()).toHaveLength(before);
  });
});

describe('fairness (33.5)', () => {
  it('turns away hostile SQL without crashing or leaking the answer', async () => {
    const { ask, seconds } = setup();
    for (const sql of [
      'PRAGMA table_info(guards)',
      "ATTACH DATABASE ':memory:' AS x",
      "SELECT load_extension('x')",
      'SELECT 1; SELECT 2',
      'SELECT * FROM sqlite_master',
    ]) {
      const reply = await ask('guards-all', sql);
      expect(reply.ok, sql).toBe(false);
      expect(JSON.stringify(reply), sql).not.toContain('FROM guards');
      seconds(3);
    }
  });

  it('gives a wrong answer nothing: no pins, and no cooldown on the right one', async () => {
    const { ask, pins, seconds } = setup();
    expect((await ask('guards-all', 'SELECT z, x FROM guards')).ok).toBe(false);
    expect(pins()).toHaveLength(0);
    seconds(3);
    expect((await ask('guards-all', 'SELECT x, z FROM guards')).ok).toBe(true);
  });

  it('is no map of the whole city: intel never reaches beyond the range asked for', async () => {
    const near = setup({ rangeMeters: 140 }, true);
    const far = setup({ rangeMeters: 140 }, false);
    const a = await near.ask('guards-all', 'SELECT x, z FROM guards');
    const b = await far.ask('guards-all', 'SELECT x, z FROM guards');
    expect(a.result?.pins ?? 0).toBeGreaterThan(0);
    expect(b.result?.pins ?? 0).toBeLessThan(near.heist.guards.snapshot().length);
  });

  it('cannot be spammed: a try every two seconds at most, one in flight', async () => {
    const { ask } = setup();
    const [first, second] = await Promise.all([
      ask('guards-all', 'SELECT x, z FROM guards'),
      ask('cash-all', 'SELECT x, z FROM cash_drops'),
    ]);
    expect([first.reason, second.reason]).toContain('busy');
  });

  it('keeps the heist’s hardest shortcut dear: a door hack is the top tier, with the longest wait', () => {
    const s = DEFAULT_CITY_DB_SETTINGS;
    const doors = s.requests.filter((r) => r.kind === 'door');
    expect(doors.length).toBe(5);
    expect(doors.every((r) => r.tier === 5)).toBe(true);
    expect(s.cooldownSeconds.door).toBeGreaterThan(s.cooldownSeconds.camera);
    expect(s.cooldownSeconds.camera).toBeGreaterThan(s.cooldownSeconds.intel);
  });
});

describe('camera hacking and door control (33.4)', () => {
  it('switches a bank’s cameras off for a while with the right UPDATE, and blinds its guards', async () => {
    const { ask, heist, seconds } = setup();
    const reply = await ask(
      `cameras-${vault.bank}`,
      `UPDATE cameras SET enabled = 0 WHERE bank = '${vault.bank}'`,
    );
    expect(reply).toMatchObject({ ok: true, result: { kind: 'camera' } });
    expect(heist.cameras.isOn(vault.bank)).toBe(false);
    expect(
      heist.cityDb
        .snapshot()
        .tables.get('cameras')
        ?.rows.filter((r) => r[1] === vault.bank)
        .every((r) => r[4] === 0),
    ).toBe(true);
    seconds(DEFAULT_CITY_DB_SETTINGS.cameraSeconds + 1);
    expect(heist.cameras.isOn(vault.bank)).toBe(true);
  });

  it('refuses an UPDATE that switches off the wrong cameras', async () => {
    const { ask, heist } = setup();
    const all = await ask(`cameras-${vault.bank}`, 'UPDATE cameras SET enabled = 0');
    expect(all).toMatchObject({ ok: false, reason: 'wrong' });
    expect(heist.cameras.isOn(vault.bank)).toBe(true);
  });

  it('refuses a camera request answered with a SELECT', async () => {
    const { ask } = setup();
    const reply = await ask(`cameras-${vault.bank}`, 'SELECT * FROM cameras');
    expect(reply.ok).toBe(false);
  });

  it('opens the next lock of a vault with the right UPDATE on its door, once', async () => {
    const { ask, heist } = setup();
    const v = heist.vaults.get(vault.id);
    const before = v?.locksOpen ?? 0;
    const reply = await ask(
      `door-${vault.bank}`,
      `UPDATE doors SET locked = 0 WHERE bank = '${vault.bank}'`,
    );
    expect(reply).toMatchObject({ ok: true, result: { kind: 'door' } });
    expect(v?.locksOpen).toBe(before + 1);
    // The door controller is not a way past every lock: it is on a cooldown.
    expect(
      await ask(`door-${vault.bank}`, `UPDATE doors SET locked = 0 WHERE bank = '${vault.bank}'`),
    ).toMatchObject({
      reason: 'cooldown',
    });
  });

  it('cannot unlock an open vault', async () => {
    const { ask, heist, seconds } = setup();
    const v = heist.vaults.get(vault.id);
    for (let k = 1; k <= (v?.lockCount ?? 0); k++) heist.openLock(vault.id, k);
    seconds(3);
    const reply = await ask(
      `door-${vault.bank}`,
      `UPDATE doors SET locked = 0 WHERE bank = '${vault.bank}'`,
    );
    expect(reply.ok).toBe(false);
  });
});
