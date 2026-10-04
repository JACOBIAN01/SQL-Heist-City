import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  questionTemplateSchema,
} from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { buildChallengeStack } from '../composition';
import { openDatabase } from '../db/database';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';

/** A whole match with the real challenge stack: ask at the console, solve in SQL, watch the lock open. */
function setup() {
  const db = openDatabase({ path: ':memory:' });
  new SqliteQuestionRepository(db).create(questionTemplateSchema.parse(sampleQuestion), null);
  const stack = buildChallengeStack(db, {
    sandbox: new InProcessSandboxRunner(),
    matchSeed: 'vault-test',
  });
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, locksPerVault: 1 },
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
  return { match, connection, send, waitFor, player: joined.player };
}

describe('cracking a vault lock end to end', () => {
  it('opens the vault when the player answers the console task correctly', async () => {
    const { connection, send, waitFor, match } = setup();

    send({ t: 'interact', ref: 1, anchor: 'bank-1:vault:console' });
    const offered = await waitFor(() => connection.jsonOf('interact_result')[0]);
    expect(offered.result).toEqual({
      action: 'open_task',
      rewardKey: 'vault:bank-1:lock-1',
      target: 'bank-1:vault',
    });

    send({
      t: 'challenge_request',
      ref: 2,
      rewardKey: 'vault:bank-1:lock-1',
      target: 'bank-1:vault',
    });
    const issued = await waitFor(() => connection.jsonOf('challenge')[0]);
    if (!issued.result.ok) throw new Error(`refused: ${issued.result.reason}`);
    const { id, story } = issued.result.challenge;
    // The story carries this player's parameters: **Dept** … **min**.
    const [, dept, min] = /\*\*(\w+)\*\*.*\*\*(\d+)\*\*/.exec(story) ?? [];

    send({
      t: 'challenge_submit',
      ref: 3,
      challengeId: id,
      sql: `SELECT name FROM employees WHERE dept = '${dept}' AND salary > ${min}`,
    });
    const graded = await waitFor(() => connection.jsonOf('challenge_result')[0]);
    expect(graded.result).toMatchObject({ status: 'correct', target: 'bank-1:vault' });

    const vaults = connection.jsonOf('vaults').at(-1)?.vaults[0];
    expect(vaults).toMatchObject({ opened: 1, locks: 1 });
    // The door no longer blocks: the match's collision map has no vault door left.
    expect(match.heist.openLock('bank-1:vault', 1)).toBe(false);
  });

  it('does not open the vault for a wrong answer', async () => {
    const { connection, send, waitFor } = setup();
    send({
      t: 'challenge_request',
      ref: 1,
      rewardKey: 'vault:bank-1:lock-1',
      target: 'bank-1:vault',
    });
    const issued = await waitFor(() => connection.jsonOf('challenge')[0]);
    if (!issued.result.ok) throw new Error('refused');
    send({
      t: 'challenge_submit',
      ref: 2,
      challengeId: issued.result.challenge.id,
      sql: 'SELECT name FROM employees',
    });
    const graded = await waitFor(() => connection.jsonOf('challenge_result')[0]);
    expect(graded.result.status).toBe('wrong');
    expect(connection.jsonOf('vaults').at(-1)?.vaults[0]?.opened).toBe(0);
  });
});
