import { beforeEach, describe, expect, it } from 'vitest';
import { questionTemplateSchema, type PublicChallenge } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { StaticSettings } from '../config/SettingsReader';
import { InMemoryQuestionRepository } from '../questions/InMemoryQuestionRepository';
import { Grader } from '../sql/Grader';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { builtInDatasets } from '../variants/datasets';
import { VariantBuilder } from '../variants/VariantBuilder';
import { ChallengeMessageHandler } from './ChallengeMessageHandler';
import { ChallengeService } from './ChallengeService';
import { QuestionSelector } from './QuestionSelector';

const base = questionTemplateSchema.parse(sampleQuestion);
const settings = new StaticSettings();
let clock: number;
let handler: ChallengeMessageHandler;
let repo: InMemoryQuestionRepository;

beforeEach(() => {
  clock = 1_000_000;
  repo = new InMemoryQuestionRepository();
  repo.create(base, null);
  repo.create({ ...base, slug: 'tier-3', tier: 3 }, null);
  const service = new ChallengeService({
    matchSeed: 'm',
    selector: new QuestionSelector(repo),
    variants: new VariantBuilder(builtInDatasets),
    grader: new Grader(new InProcessSandboxRunner()),
    settings,
    now: () => clock,
  });
  handler = new ChallengeMessageHandler(service, settings, () => clock);
});

async function issue(rewardKey = 'heal:small') {
  const reply = await handler.handle('p1', { t: 'challenge_request', ref: 1, rewardKey });
  if (reply.t !== 'challenge' || !reply.result.ok) throw new Error('issue failed');
  return reply.result.challenge as PublicChallenge;
}

describe('ChallengeMessageHandler', () => {
  it('issues a challenge and echoes ref and server time', async () => {
    const reply = await handler.handle('p1', {
      t: 'challenge_request',
      ref: 7,
      rewardKey: 'heal:small',
    });
    expect(reply).toMatchObject({ t: 'challenge', ref: 7, now: clock, result: { ok: true } });
  });

  it('never leaks the reference SQL in any reply', async () => {
    const c = await issue();
    const run = await handler.handle('p1', {
      t: 'challenge_run',
      ref: 2,
      challengeId: c.id,
      sql: 'SELECT 1',
    });
    const text = JSON.stringify([c, run]);
    expect(text).not.toMatch(/SELECT name FROM employees WHERE dept/);
    expect(text).not.toContain('reference');
  });

  it('previews and grades through the service', async () => {
    const c = await issue();
    const run = await handler.handle('p1', {
      t: 'challenge_run',
      ref: 2,
      challengeId: c.id,
      sql: 'SELECT name FROM employees',
    });
    expect(run).toMatchObject({ t: 'challenge_preview', ref: 2, result: { ok: true } });
    clock += 5_000;
    const submit = await handler.handle('p1', {
      t: 'challenge_submit',
      ref: 3,
      challengeId: c.id,
      sql: 'SELECT name FROM employees',
    });
    expect(submit).toMatchObject({
      t: 'challenge_result',
      ref: 3,
      result: { status: 'wrong', lockedUntil: clock + 10_000 },
    });
  });

  it('maps vault locks to the bank tier and unknown rewards to an error result', async () => {
    const vault = await handler.handle('p1', {
      t: 'challenge_request',
      ref: 1,
      rewardKey: 'vault:bank-3:lock-1',
    });
    expect(vault.t === 'challenge' && vault.result.ok && vault.result.challenge.tier).toBe(3);
    clock += 5_000;
    const unknown = await handler.handle('p1', {
      t: 'challenge_request',
      ref: 2,
      rewardKey: 'gun:laser',
    });
    expect(unknown).toMatchObject({
      t: 'challenge',
      result: { ok: false, reason: 'unknown_reward' },
    });
  });

  it('abandons the current challenge', async () => {
    const c = await issue();
    expect(await handler.handle('p1', { t: 'challenge_abandon', ref: 9 })).toEqual({
      t: 'challenge_abandoned',
      ref: 9,
      now: clock,
    });
    const run = await handler.handle('p1', {
      t: 'challenge_run',
      ref: 10,
      challengeId: c.id,
      sql: 'SELECT 1',
    });
    expect(run).toMatchObject({ result: { ok: false, reason: 'not_found' } });
  });

  it.each([
    ['unknown type', { t: 'nope', ref: 1 }],
    ['missing fields', { t: 'challenge_run', ref: 1 }],
    ['oversized sql', { t: 'challenge_run', ref: 1, challengeId: 'x', sql: 'x'.repeat(6000) }],
    ['not an object', 'hello'],
  ])('rejects %s with a bad_message error', async (_label, raw) => {
    const reply = await handler.handle('p1', raw);
    expect(reply).toMatchObject({ t: 'challenge_error', code: 'bad_message' });
  });

  it('keeps players separate', async () => {
    const c = await issue();
    const other = await handler.handle('p2', {
      t: 'challenge_run',
      ref: 1,
      challengeId: c.id,
      sql: 'SELECT 1',
    });
    expect(other).toMatchObject({ result: { ok: false, reason: 'not_found' } });
  });
});
