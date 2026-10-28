import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type GhostMessage,
  type GhostResultMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InMemoryGhostStore } from '../progress/GhostStore';

const city = mapById('city') as GameMap;
const settle = () => new Promise((r) => setTimeout(r, 0));
const BANK = 'bank-1';

async function setup(store = new InMemoryGhostStore()) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
    },
    seed: 'ghost-test',
  });
  match.heist.ghosts.bindStore(store);
  const join = (name: string, accountId?: number) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection, accountId);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  };
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  return { match, join, store, heist: match.heist, seconds };
}

const ghostMsg = (c: FakeConnection) =>
  c.jsonOf('ghost').at(-1) as unknown as GhostMessage | undefined;
const result = (c: FakeConnection) =>
  c.jsonOf('ghost_result').at(-1) as unknown as GhostResultMessage | undefined;

/** A whole heist for `who`: begin, run for `taking` seconds, finish. */
async function runHeist(
  s: Awaited<ReturnType<typeof setup>>,
  who: { player: ReturnType<Awaited<ReturnType<typeof setup>>['join']>['player'] },
  taking: number,
  take = 8_000,
) {
  s.heist.events.publish({ type: 'intel_gained', player: who.player, bank: BANK, level: 1 });
  s.seconds(taking);
  s.heist.events.publish({
    type: 'heist_complete',
    player: who.player,
    bank: BANK,
    tier: 1,
    mastery: 0,
    take,
  });
  await settle();
}

describe('ghost heists (34.6)', () => {
  it('notes where a runner stands each second from their first move on a bank', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    s.heist.events.publish({ type: 'intel_gained', player: a.player, bank: BANK, level: 1 });
    s.seconds(10);
    const run = s.heist.ghosts.runOf(a.player);
    expect(run?.bank).toBe(BANK);
    expect(run?.points.length).toBeGreaterThanOrEqual(10 * 3);
    expect((run?.points.length ?? 0) % 3).toBe(0);
  });

  it('keeps a finished heist as the ghost, and tells the runner it is a record', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    await runHeist(s, a, 40);
    const best = await s.store.best(BANK);
    expect(best).toMatchObject({ name: 'Ana', take: 8_000 });
    expect(best?.seconds).toBeGreaterThanOrEqual(39);
    expect(result(a.connection)).toMatchObject({ beat: true, record: true, bank: BANK });
    expect(result(a.connection)?.ghost).toBeUndefined();
  });

  it('sends the ghost to the next runner the moment they begin on that bank', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    await runHeist(s, a, 40);
    const b = s.join('Ben', 2);
    expect(ghostMsg(b.connection)).toBeUndefined();
    s.heist.events.publish({
      type: 'lock_opened',
      vault: [...s.heist.vaults.all()][0] as never,
      lock: 1,
      player: b.player,
    });
    await settle();
    const ghost = ghostMsg(b.connection);
    expect(ghost).toMatchObject({ bank: BANK, name: 'Ana', mine: false });
    expect(ghost?.trace.points.length).toBeGreaterThan(30);
  });

  it('says whether a run beat the ghost, and replaces it only when it did', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    await runHeist(s, a, 40);
    const slow = s.join('Slow', 2);
    await runHeist(s, slow, 90);
    expect(result(slow.connection)).toMatchObject({
      beat: false,
      record: false,
      ghost: { name: 'Ana' },
    });
    expect((await s.store.best(BANK))?.name).toBe('Ana');
    const fast = s.join('Fast', 3);
    await runHeist(s, fast, 20);
    expect(result(fast.connection)).toMatchObject({ beat: true, record: true });
    expect((await s.store.best(BANK))?.name).toBe('Fast');
  });

  it('lets a guest race the ghost but not set one', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    await runHeist(s, a, 40);
    const guest = s.join('Guest');
    await runHeist(s, guest, 10);
    expect(result(guest.connection)).toMatchObject({ beat: true, record: false });
    expect((await s.store.best(BANK))?.name).toBe('Ana');
  });

  it('marks a runner’s own ghost as theirs', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    await runHeist(s, a, 30);
    s.heist.events.publish({ type: 'intel_gained', player: a.player, bank: BANK, level: 1 });
    await settle();
    expect(ghostMsg(a.connection)?.mine).toBe(true);
  });

  it('drops a run that ends in death, and a heist too short to matter', async () => {
    const s = await setup();
    const a = s.join('Ana', 1);
    s.heist.events.publish({ type: 'intel_gained', player: a.player, bank: BANK, level: 1 });
    s.seconds(10);
    s.match.damage(a.player, 999, a.player);
    expect(s.heist.ghosts.runOf(a.player)).toBeUndefined();
    const b = s.join('Ben', 2);
    await runHeist(s, b, 1);
    expect(await s.store.best(BANK)).toBeUndefined();
  });
});
