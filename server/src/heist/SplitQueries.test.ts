import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CITY_DB_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type CityDbSettings,
  type GameMap,
  type SplitRequest,
  type SplitStateMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import type { ChallengeGateway } from './ChallengeGateway';

const city = mapById('city') as GameMap;
const runner = new InProcessSandboxRunner();
const split = DEFAULT_CITY_DB_SETTINGS.splits[0] as SplitRequest;
if (!split) throw new Error('no split');
const [p1, p2, p3] = split.parts;

function setup(over: Partial<CityDbSettings> = {}) {
  const settings: CityDbSettings = { ...DEFAULT_CITY_DB_SETTINGS, ...over };
  const gateway: ChallengeGateway = {
    handle: async () => {
      throw new Error('not used');
    },
    playerLeft: () => {},
    city: { run: (job) => runner.run(job), settings: () => settings },
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
    seed: 'split-test',
  });
  const mates = Array.from({ length: 3 }, (_, i) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, `M${i + 1}`, connection);
    if (!r.ok) throw new Error('join failed');
    r.player.squad = 1;
    return { player: r.player, connection };
  });
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  for (const m of mates) {
    m.player.alive = true;
    m.player.hp = match.maxHp;
  }
  let ref = 0;
  const submit = (who: number, part: number, sql: string) =>
    match.heist.splits.submit(mates[who]?.player as never, {
      t: 'split_submit',
      ref: ++ref,
      split: split.id,
      part,
      sql,
    });
  const state = (who: number) =>
    mates[who]?.connection.jsonOf('split_state').at(-1) as unknown as SplitStateMessage | undefined;
  return { match, mates, heist: match.heist, submit, state };
}

describe('co-op split queries (34.2)', () => {
  it('is offered to squads as a three-part query, without the answers', () => {
    const { heist } = setup();
    const offered = heist.intel.catalog().splits;
    expect(offered.length).toBeGreaterThan(0);
    const text = JSON.stringify(offered);
    expect(text).not.toContain('reference');
    expect(text).not.toContain('COUNT(*) AS guards');
    expect(offered[0]?.parts).toHaveLength(3);
  });

  it('accepts each member’s part on its own, in any order, and tells the squad', async () => {
    const { submit, state } = setup();
    expect((await submit(2, 2, p3.reference)).ok).toBe(true); // the join first
    expect(state(0)?.parts.map((p) => p.status)).toEqual(['open', 'open', 'done']);
    expect((await submit(0, 0, p1.reference)).ok).toBe(true);
    expect(state(1)?.parts.map((p) => p.status)).toEqual(['done', 'open', 'done']);
    expect(state(2)?.parts[2]?.by).toBe('M3');
  });

  it('refuses a wrong part with a hint about its shape, and keeps the part open', async () => {
    const { submit, heist, mates } = setup();
    const reply = await submit(0, 0, 'SELECT bank FROM guards');
    expect(reply).toMatchObject({ ok: false, reason: 'wrong' });
    expect(reply.feedback?.message.length).toBeGreaterThan(5);
    expect(heist.splits.stateOf(mates[0]?.player.squad ?? 0)).toBeUndefined();
  });

  it('grades the join against the right two parts, so it does not depend on the others’ SQL', async () => {
    const { submit } = setup();
    const wrong = await submit(
      2,
      2,
      'SELECT g.bank, g.guards, c.cameras_on FROM guard_counts g JOIN camera_status c ON c.bank = g.bank',
    );
    expect(wrong).toMatchObject({ ok: false, reason: 'wrong' });
    expect((await submit(2, 2, p3.reference)).ok).toBe(true);
  });

  it('opens the squad’s next lock when all three parts are in, and pays each of them', async () => {
    const { submit, heist, mates, state } = setup();
    const vault = [...heist.vaults.all()].find((v) => v.spec.bank === split.bank);
    const before = vault?.locksOpen ?? 0;
    await submit(0, 0, p1.reference);
    await submit(1, 1, p2.reference);
    const last = await submit(2, 2, p3.reference);
    expect(last).toMatchObject({ ok: true, result: { kind: 'door' } });
    expect(vault?.locksOpen).toBe(before + 1);
    for (const m of mates)
      expect(m.player.cash).toBeGreaterThanOrEqual(DEFAULT_CITY_DB_SETTINGS.splitReward);
    expect(state(0)?.opened).toBe(true);
  });

  it('takes any right way of writing a part', async () => {
    const { submit } = setup();
    const reply = await submit(
      0,
      0,
      'select g.bank as bank, count(g.id) as guards from guards g group by g.bank',
    );
    expect(reply.ok).toBe(true);
  });

  it('is for squads: a student with no squad cannot', async () => {
    const { match, heist } = setup();
    const r = match.join(PROTOCOL_VERSION, 'Solo', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    const reply = await heist.splits.submit(r.player, {
      t: 'split_submit',
      ref: 1,
      split: split.id,
      part: 0,
      sql: p1.reference,
    });
    expect(reply).toMatchObject({ ok: false, reason: 'squad' });
  });

  it('gives a member one part only, and one member to a part', async () => {
    const { submit } = setup();
    await submit(0, 0, p1.reference);
    expect(await submit(0, 1, p2.reference)).toMatchObject({ ok: false, reason: 'taken' });
    expect(await submit(1, 0, p1.reference)).toMatchObject({ ok: false, reason: 'taken' });
  });

  it('lets a half-built query lapse after the window', async () => {
    const { submit, heist, match, mates } = setup({ splitWindowSeconds: 5 });
    await submit(0, 0, p1.reference);
    expect(heist.splits.stateOf(mates[0]?.player.squad ?? 0)).toEqual([true, false, false]);
    for (let i = 0; i < 6 * match.tickRate; i++) match.step();
    // A fresh attempt starts again: the first member may now take another part.
    expect((await submit(0, 1, p2.reference)).ok).toBe(true);
    expect(heist.splits.stateOf(mates[0]?.player.squad ?? 0)).toEqual([false, true, false]);
  });

  it('refuses hostile SQL in a part', async () => {
    const { submit } = setup();
    for (const sql of [
      "ATTACH DATABASE ':memory:' AS x",
      'PRAGMA table_info(guards)',
      'SELECT 1; SELECT 2',
    ])
      expect((await submit(0, 0, sql)).ok, sql).toBe(false);
  });
});
