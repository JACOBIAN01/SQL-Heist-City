import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHEAT_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  questionTemplateSchema,
  type CheatSettings,
} from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { MemorySink } from '../analytics/AttemptSink';
import { buildChallengeStack } from '../composition';
import { SqliteSettingsStore, type SettingsStore } from '../config/SettingsStore';
import { openDatabase } from '../db/database';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { hashCode } from '../security/CodeHash';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';

const CODE = 'open-says-me';

/** A whole match with the real challenge stack and the cheat set in settings. */
async function setup(over: Partial<CheatSettings> = {}) {
  const db = openDatabase({ path: ':memory:' });
  new SqliteQuestionRepository(db).create(questionTemplateSchema.parse(sampleQuestion), null);
  const store: SettingsStore = new SqliteSettingsStore(db);
  await store.put('cheat', {
    ...DEFAULT_CHEAT_SETTINGS,
    scope: 'all',
    codeHash: await hashCode(CODE),
    ...over,
  });
  let clock = Date.now();
  const attempts = new MemorySink();
  const stack = buildChallengeStack(db, {
    sandbox: new InProcessSandboxRunner(),
    matchSeed: 'cheat-test',
    attempts,
    now: () => clock,
  });
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, locksPerVault: 2 },
    challenges: stack.handler,
  });
  const connection = new FakeConnection();
  const joined = match.join(PROTOCOL_VERSION, 'Ana', connection);
  if (!joined.ok) throw new Error('join failed');
  Object.assign(joined.player.body, { x: 2.4, y: 6, z: -5.3 });
  const send = (m: object) => match.receiveJson(joined.player.id, JSON.stringify(m));
  const waitFor = async <T>(read: () => T | undefined): Promise<T> => {
    for (let i = 0; i < 200; i++) {
      const found = read();
      if (found !== undefined) return found;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('timed out');
  };
  let ref = 0;
  /** Opens the lock-1 question and returns its challenge id. */
  const ask = async (lock = 1) => {
    connection.clear();
    send({
      t: 'challenge_request',
      ref: ++ref,
      rewardKey: `vault:bank-1:lock-${lock}`,
      target: 'bank-1:vault',
    });
    const issued = await waitFor(() => connection.jsonOf('challenge')[0]);
    if (!issued.result.ok) throw new Error(`refused: ${issued.result.reason}`);
    return issued.result.challenge.id;
  };
  const type = async (challengeId: string, code: string) => {
    connection.clear();
    send({ t: 'cheat', ref: ++ref, challengeId, code });
    const reply = await waitFor(() => connection.jsonOf('challenge_cheat')[0]);
    return reply.result;
  };
  const advance = (ms: number) => (clock += ms);
  return { match, connection, send, waitFor, ask, type, advance, attempts, player: joined.player };
}

describe('the cheat code (37.2)', () => {
  it('passes the open question, opens the lock, and records a cheat, never a solve', async () => {
    const s = await setup();
    const id = await s.ask();
    const result = await s.type(id, CODE);
    expect(result).toMatchObject({ ok: true });
    expect(result).toMatchObject({ rewardKey: 'vault:bank-1:lock-1', target: 'bank-1:vault' });
    expect(s.connection.jsonOf('vaults').at(-1)?.vaults[0]).toMatchObject({ opened: 1 });
    expect(s.attempts.items.map((i) => i.item.outcome)).toEqual(['cheat']);
    expect(s.attempts.events.map((e) => e.kind)).toContain('cheat');
  });

  it('refuses a wrong code and leaves the question open to be solved properly', async () => {
    const s = await setup();
    const id = await s.ask();
    expect(await s.type(id, 'not-the-code')).toMatchObject({ ok: false, reason: 'wrong' });
    expect(s.connection.jsonOf('vaults').at(-1)?.vaults[0]?.opened ?? 0).toBe(0);
    expect(s.attempts.items).toHaveLength(0);
    s.advance(1500);
    expect(await s.type(id, CODE)).toMatchObject({ ok: true });
  });

  it('says nothing useful when it is off, not set, or not for this place', async () => {
    for (const over of [
      { scope: 'off' as const },
      { codeHash: '' },
      { scope: 'tutorial' as const },
      { scope: 'rooms' as const, classIds: [9] },
    ]) {
      const s = await setup(over);
      const id = await s.ask();
      expect(await s.type(id, CODE)).toMatchObject({ ok: false, reason: 'refused' });
      expect(s.attempts.items).toHaveLength(0);
    }
  });

  it('locks a player out after too many wrong codes, even for the right one', async () => {
    const s = await setup({ lockoutTries: 3, lockoutSeconds: 60 });
    const id = await s.ask();
    for (let i = 0; i < 2; i++) {
      expect(await s.type(id, `bad-${i}`)).toMatchObject({ reason: 'wrong' });
      s.advance(1500);
    }
    expect(await s.type(id, 'bad-3')).toMatchObject({ reason: 'locked' });
    s.advance(1500);
    expect(await s.type(id, CODE)).toMatchObject({ ok: false, reason: 'locked' });
    s.advance(61_000);
    expect(await s.type(id, CODE)).toMatchObject({ ok: true });
  });

  it('limits passes per round', async () => {
    const s = await setup({ maxPerRound: 1 });
    expect(await s.type(await s.ask(), CODE)).toMatchObject({ ok: true });
    s.advance(10_000);
    const again = await s.ask(2);
    expect(await s.type(again, CODE)).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('can pass a question without paying its reward', async () => {
    const s = await setup({ payReward: false });
    expect(await s.type(await s.ask(), CODE)).toMatchObject({ ok: true });
    expect(s.connection.jsonOf('vaults').at(-1)?.vaults[0]?.opened ?? 0).toBe(0);
    expect(s.attempts.items.map((i) => i.item.outcome)).toEqual(['cheat']);
  });

  it('has nothing to pass when no question is open', async () => {
    const s = await setup();
    expect(await s.type('nothing', CODE)).toMatchObject({ ok: false, reason: 'no_task' });
  });

  it('never writes the code into an anomaly line', async () => {
    const s = await setup();
    const id = await s.ask();
    await s.type(id, 'guess-123');
    expect(s.match.anomalies.counts()).toEqual({ bad_cheat_code: 1 });
    expect(JSON.stringify(s.match.anomalies.counts())).not.toContain('guess-123');
  });

  it('tells a player the key combination only where a pass can work', async () => {
    const on = await setup({ combo: ['KeyQ', 'KeyW'] });
    const joined = on.match.join(PROTOCOL_VERSION, 'Late', new FakeConnection());
    if (!joined.ok) throw new Error('join failed');
    expect(on.connection.jsonOf('cheat_info').at(-1)).toMatchObject({ combo: ['KeyQ', 'KeyW'] });
    const off = await setup({ scope: 'off' });
    expect(off.connection.jsonOf('cheat_info')).toHaveLength(0);
  });

  it('never lets the code reach a log, the learning record or the round replay (37.6)', async () => {
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const s = await setup();
      const id = await s.ask();
      const typed = 'typed-secret-0451';
      await s.type(id, typed);
      s.advance(1500);
      s.send({ t: 'cheat', challengeId: id, code: typed }); // malformed: no ref
      s.advance(1500);
      await s.type(id, CODE);
      const kept = JSON.stringify([
        s.attempts.items,
        s.attempts.events,
        s.match.heist.recorder.snapshot(),
        s.match.anomalies.counts(),
      ]);
      for (const secret of [typed, CODE, await hashCode(CODE).then((h) => h.split('$')[5] ?? 'x')])
        expect(kept).not.toContain(secret);
      expect(lines.join('')).not.toContain(typed);
      expect(lines.join('')).not.toContain(CODE);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});
