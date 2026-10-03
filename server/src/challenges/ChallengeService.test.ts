import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  questionTemplateSchema,
  type PublicChallenge,
} from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { StaticSettings } from '../config/SettingsReader';
import { InMemoryQuestionRepository } from '../questions/InMemoryQuestionRepository';
import { Grader } from '../sql/Grader';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { builtInDatasets } from '../variants/datasets';
import { VariantBuilder } from '../variants/VariantBuilder';
import { ChallengeService } from './ChallengeService';
import { QuestionSelector } from './QuestionSelector';

const base = questionTemplateSchema.parse(sampleQuestion);
const variants = new VariantBuilder(builtInDatasets);

let clock: number;
let repo: InMemoryQuestionRepository;
let service: ChallengeService;
let warnings: string[];
let ids: number;

beforeEach(() => {
  clock = 1_000_000;
  ids = 0;
  warnings = [];
  repo = new InMemoryQuestionRepository();
  repo.create(base, null);
  service = new ChallengeService({
    matchSeed: 'match-1',
    selector: new QuestionSelector(repo),
    variants,
    grader: new Grader(new InProcessSandboxRunner()),
    settings: new StaticSettings(),
    now: () => clock,
    newId: () => `c${++ids}`,
    logger: { warn: (m) => warnings.push(m) },
  });
});

const settings = DEFAULT_CHALLENGE_SETTINGS;

async function issue(player = 'p1', rewardKey = 'heal:small'): Promise<PublicChallenge> {
  const result = await service.issue({ player, rewardKey, target: 'self' });
  if (!result.ok) throw new Error(`issue failed: ${result.reason}`);
  return result.challenge;
}

/** Recreates the server-side variant to get the right answer in tests. */
function answerFor(player: string, rewardKey: string, attempt: number): string {
  return variants.build(base, `match-1|${player}|${rewardKey}|${attempt}`).referenceSql;
}

describe('ChallengeService.issue', () => {
  it('returns a public challenge without reference SQL or expected rows', async () => {
    const c = await issue();
    expect(c).toMatchObject({
      id: 'c1',
      rewardKey: 'heal:small',
      tier: 1,
      title: base.title,
      hintCosts: [0.05],
      hintCostMode: 'fraction',
    });
    expect(c.expiresAt).toBe(clock + settings.ttlSec * 1000);
    expect(c.tables[0]?.sampleRows).toHaveLength(settings.sampleRows);
    const serialized = JSON.stringify(c);
    expect(serialized).not.toMatch(/SELECT name FROM/);
    expect(serialized).not.toContain('reference');
  });

  it('gives different players different variants of the same question', async () => {
    const a = await issue('p1');
    const b = await issue('p2');
    expect(a.story === b.story && JSON.stringify(a.tables) === JSON.stringify(b.tables)).toBe(
      false,
    );
  });

  it('rejects unknown rewards and empty pools', async () => {
    expect(await service.issue({ player: 'p1', rewardKey: 'gun:laser' })).toEqual({
      ok: false,
      reason: 'unknown_reward',
    });
    repo.setEnabled(1, false, null);
    clock += settings.requestCooldownMs;
    expect(await service.issue({ player: 'p1', rewardKey: 'heal:small' })).toEqual({
      ok: false,
      reason: 'no_questions',
    });
  });

  it('rate-limits requests', async () => {
    await issue();
    const again = await service.issue({ player: 'p1', rewardKey: 'heal:small' });
    expect(again).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAt: clock + settings.requestCooldownMs,
    });
  });

  it('skips a question whose reference is broken and logs it', async () => {
    repo.setEnabled(1, false, null);
    repo.create({ ...base, slug: 'broken', reference_sql: 'SELECT nope FROM employees' }, null);
    expect(await service.issue({ player: 'p1', rewardKey: 'heal:small' })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(warnings).toContain('skipping broken question');
  });
});

describe('ChallengeService.submit', () => {
  it('accepts the right answer once and reports the reward', async () => {
    const c = await issue();
    const result = await service.submit('p1', c.id, answerFor('p1', 'heal:small', 1));
    expect(result).toEqual({ status: 'correct', rewardKey: 'heal:small', target: 'self' });
    clock += settings.submitCooldownMs;
    expect(await service.submit('p1', c.id, answerFor('p1', 'heal:small', 1))).toEqual({
      status: 'rejected',
      reason: 'not_found',
    });
  });

  it('locks after a wrong answer, then accepts after the lockout', async () => {
    const c = await issue();
    const wrong = await service.submit('p1', c.id, 'SELECT name FROM employees');
    expect(wrong).toMatchObject({
      status: 'wrong',
      lockedUntil: clock + settings.lockoutSec * 1000,
    });
    clock += 5_000;
    expect(await service.submit('p1', c.id, answerFor('p1', 'heal:small', 1))).toMatchObject({
      status: 'locked',
    });
    clock += settings.lockoutSec * 1000;
    expect(await service.submit('p1', c.id, answerFor('p1', 'heal:small', 1))).toMatchObject({
      status: 'correct',
    });
  });

  it('SQL errors also count as wrong attempts', async () => {
    const c = await issue();
    expect(await service.submit('p1', c.id, 'SELECT nope FROM employees')).toMatchObject({
      status: 'wrong',
      feedback: { code: 'sql_error' },
    });
  });

  it("rejects another player's answer: copied queries and ids don't work", async () => {
    const mine = await issue('p1');
    await issue('p2');
    expect(await service.submit('p1', mine.id, answerFor('p2', 'heal:small', 1))).toMatchObject({
      status: 'wrong',
    });
    expect(await service.submit('p2', mine.id, answerFor('p1', 'heal:small', 1))).toEqual({
      status: 'rejected',
      reason: 'not_found',
    });
  });

  it('expires challenges without penalty', async () => {
    const c = await issue();
    clock += settings.ttlSec * 1000;
    expect(await service.submit('p1', c.id, 'SELECT 1')).toEqual({
      status: 'rejected',
      reason: 'expired',
    });
  });

  it('switching task replaces the challenge; the new one is a fresh variant', async () => {
    const heal = await issue('p1', 'heal:small');
    clock += settings.requestCooldownMs;
    const gun = await issue('p1', 'gun:pistol');
    expect(await service.submit('p1', heal.id, 'SELECT 1')).toEqual({
      status: 'rejected',
      reason: 'not_found',
    });
    expect(await service.submit('p1', gun.id, answerFor('p1', 'gun:pistol', 1))).toMatchObject({
      status: 'correct',
      rewardKey: 'gun:pistol',
    });
  });

  it('re-requesting the same reward gives a new variant (attempt counter)', async () => {
    const first = await issue();
    clock += settings.requestCooldownMs;
    const second = await issue();
    expect(
      second.story === first.story &&
        JSON.stringify(second.tables) === JSON.stringify(first.tables),
    ).toBe(false);
    expect(await service.submit('p1', second.id, answerFor('p1', 'heal:small', 2))).toMatchObject({
      status: 'correct',
    });
  });

  it('rate-limits submits even when lockout is disabled', async () => {
    service = new ChallengeService({
      matchSeed: 'match-1',
      selector: new QuestionSelector(repo),
      variants,
      grader: new Grader(new InProcessSandboxRunner()),
      settings: new StaticSettings({ ...settings, lockoutSec: 0 }),
      now: () => clock,
    });
    const c = await issue();
    expect((await service.submit('p1', c.id, 'SELECT nope')).status).toBe('wrong');
    expect(await service.submit('p1', c.id, 'SELECT nope')).toEqual({
      status: 'rejected',
      reason: 'rate_limited',
      retryAt: clock + settings.submitCooldownMs,
    });
  });

  it('uses explicit tiers for vault locks', async () => {
    repo.create({ ...base, slug: 'tier-3', tier: 3 }, null);
    const c = await service.issue({
      player: 'p1',
      rewardKey: 'vault:bank-1:lock-3',
      tiers: { min: 3, max: 3 },
    });
    expect(c.ok && c.challenge.tier).toBe(3);
  });
});

describe('ChallengeService.hint', () => {
  const twoHints = () =>
    repo.update(
      1,
      {
        ...base,
        hints: [
          { text: 'First nudge', cost: 0.05 },
          { text: 'Bigger nudge', cost: 0.1 },
        ],
      },
      null,
    );

  it('publishes hint costs but never the hint text', async () => {
    twoHints();
    const c = await issue();
    expect(c.hintCosts).toEqual([0.05, 0.1]);
    expect(JSON.stringify(c)).not.toContain('First nudge');
  });

  it('reveals hints in order and charges each one once', async () => {
    twoHints();
    const c = await issue();
    expect(service.hint('p1', c.id, 0)).toEqual({
      ok: true,
      hint: { index: 0, text: 'First nudge', cost: 0.05, costMode: 'fraction', charged: true },
    });
    // Asking again is free (safe to retry after a lost reply).
    expect(service.hint('p1', c.id, 0)).toMatchObject({ ok: true, hint: { charged: false } });
    expect(service.hint('p1', c.id, 1)).toMatchObject({
      ok: true,
      hint: { text: 'Bigger nudge', charged: true },
    });
  });

  it('refuses to skip ahead or to reveal hints that do not exist', async () => {
    twoHints();
    const c = await issue();
    expect(service.hint('p1', c.id, 1)).toEqual({ ok: false, reason: 'out_of_order' });
    expect(service.hint('p1', c.id, 2)).toEqual({ ok: false, reason: 'no_such_hint' });
  });

  it('is bound to the player and to a live challenge', async () => {
    twoHints();
    const c = await issue();
    expect(service.hint('p2', c.id, 0)).toEqual({ ok: false, reason: 'not_found' });
    clock += settings.ttlSec * 1000;
    expect(service.hint('p1', c.id, 0)).toEqual({ ok: false, reason: 'expired' });
  });

  it('uses the question version the challenge was issued from', async () => {
    twoHints();
    const c = await issue();
    repo.update(1, { ...base, hints: [{ text: 'Edited later', cost: 0.9 }] }, null);
    expect(service.hint('p1', c.id, 0)).toMatchObject({ ok: true, hint: { text: 'First nudge' } });
  });
});

describe('ChallengeService.run', () => {
  it('previews rows without locking', async () => {
    const c = await issue();
    const run = await service.run('p1', c.id, 'SELECT name, salary FROM employees');
    expect(run.ok && run.preview.rows.length).toBe(5);
    const submit = await service.submit('p1', c.id, answerFor('p1', 'heal:small', 1));
    expect(submit.status).toBe('correct');
  });

  it('returns SQL errors as feedback and rate-limits', async () => {
    const c = await issue();
    expect(await service.run('p1', c.id, 'SELECT nope FROM employees')).toMatchObject({
      ok: false,
      reason: 'sql',
      feedback: { code: 'sql_error' },
    });
    expect(await service.run('p1', c.id, 'SELECT 1')).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });
});
