import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_SETTINGS, questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { MemorySink } from '../analytics/AttemptSink';
import { StaticConcepts } from '../concepts/ConceptStore';
import { StaticSettings } from '../config/SettingsReader';
import { InMemoryQuestionRepository } from '../questions/InMemoryQuestionRepository';
import { Grader } from '../sql/Grader';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { builtInDatasets } from '../variants/datasets';
import { VariantBuilder } from '../variants/VariantBuilder';
import { ChallengeService } from './ChallengeService';
import { QuestionSelector } from './QuestionSelector';

const base = questionTemplateSchema.parse({
  ...sampleQuestion,
  rcsbe: 'C',
  bloom: 'understand',
  marks: 6,
  topic: ['select', 'where'],
});
const variants = new VariantBuilder(builtInDatasets);
let clock: number;
let ids: number;
let sink: MemorySink;
let service: ChallengeService;

beforeEach(() => {
  clock = 1_000_000;
  ids = 0;
  sink = new MemorySink();
  const repo = new InMemoryQuestionRepository();
  repo.create(base, null);
  service = new ChallengeService({
    matchSeed: 'm',
    selector: new QuestionSelector(repo),
    variants,
    grader: new Grader(new InProcessSandboxRunner()),
    settings: new StaticSettings(),
    now: () => clock,
    newId: () => `c${++ids}`,
    attempts: sink,
  });
});

const who = { accountId: 42, classId: 7, round: 3 };
const open = async (player = 'p1', reward = 'heal:small', over: object = {}) => {
  const r = await service.issue({ player, rewardKey: reward, who, ...over });
  if (!r.ok) throw new Error(r.reason);
  return r.challenge;
};
const right = (player: string, reward: string) =>
  variants.build(base, `m|${player}|${reward}|1`).referenceSql;
const kinds = () => sink.events.map((e) => e.kind);
const last = () => sink.items.at(-1)?.item;

describe('attempt events and item records (15.2)', () => {
  it('records a solved question with the tags, marks and who, snapshotted at issue', async () => {
    const c = await open();
    clock += 30_000;
    const done = await service.submit('p1', c.id, right('p1', 'heal:small'));
    expect(done.status).toBe('correct');
    expect(kinds()).toEqual(['issued', 'submit_correct']);
    expect(sink.items).toHaveLength(1);
    expect(sink.items[0]?.who).toEqual({ ...who, playerKey: 'p1' });
    expect(last()).toMatchObject({
      challengeId: 'c1',
      accountId: 42,
      classId: 7,
      round: 3,
      rcsbe: 'C',
      bloom: 'understand',
      marks: 6,
      tier: 1,
      topics: ['select', 'where'],
      outcome: 'solved',
      submits: 1,
      wrongSubmits: 0,
      hintsPaid: 0,
      secondsOpen: 30,
      tutorial: false,
    });
  });

  it('counts runs, wrong submits, lockouts and paid hints on the way to a solve', async () => {
    const c = await open();
    clock += 1000;
    await service.run('p1', c.id, 'SELECT name FROM employees');
    clock += 1000;
    expect((await service.submit('p1', c.id, 'SELECT 1')).status).toBe('wrong');
    expect((await service.submit('p1', c.id, 'SELECT 1')).status).toBe('locked'); // refused: not an attempt
    clock += DEFAULT_CHALLENGE_SETTINGS.lockoutSec * 1000 + 1000;
    expect(service.hint('p1', c.id, 0).ok).toBe(true);
    service.hint('p1', c.id, 0); // asking again is free and not a second payment
    expect((await service.submit('p1', c.id, right('p1', 'heal:small'))).status).toBe('correct');
    expect(kinds()).toEqual(['issued', 'run', 'submit_wrong', 'lockout', 'hint', 'submit_correct']);
    expect(last()).toMatchObject({
      runs: 1,
      submits: 2,
      wrongSubmits: 1,
      hintsPaid: 1,
      outcome: 'solved',
    });
  });

  it('reports a question that ran out of time, once', async () => {
    const c = await open();
    clock += DEFAULT_CHALLENGE_SETTINGS.ttlSec * 1000 + 1;
    expect((await service.submit('p1', c.id, 'SELECT 1')).status).toBe('rejected');
    await service.submit('p1', c.id, 'SELECT 1'); // already gone
    expect(sink.items).toHaveLength(1);
    expect(last()).toMatchObject({ outcome: 'expired', submits: 0 });
    expect(kinds()).toEqual(['issued', 'expire']);
  });

  it('reports abandoning, switching task, dying and leaving as their own outcomes', async () => {
    await open('p1');
    service.abandon('p1');
    expect(last()?.outcome).toBe('abandoned');

    await open('p2');
    clock += DEFAULT_CHALLENGE_SETTINGS.requestCooldownMs + 1;
    await open('p2', 'gun:pistol'); // asking for something else drops the first
    expect(last()).toMatchObject({ outcome: 'switched', rewardKey: 'heal:small' });
    service.playerDied('p2');
    expect(last()).toMatchObject({ outcome: 'died', rewardKey: 'gun:pistol' });

    await open('p3');
    service.forgetPlayer('p3');
    expect(last()?.outcome).toBe('left');
    expect(sink.items.map((i) => i.item.outcome)).toEqual([
      'abandoned',
      'switched',
      'died',
      'left',
    ]);
  });

  it('marks a tutorial question as such, and treats a player with no open question as nothing to report', async () => {
    const c = await open('p1', 'heal:small', { revealSolution: true });
    await service.submit('p1', c.id, right('p1', 'heal:small'));
    expect(last()?.tutorial).toBe(true);
    const n = sink.items.length;
    service.abandon('nobody');
    service.playerDied('nobody');
    expect(sink.items.length).toBe(n);
  });

  it('works without a sink (nothing to report to)', async () => {
    const repo = new InMemoryQuestionRepository();
    repo.create(base, null);
    const plain = new ChallengeService({
      matchSeed: 'm',
      selector: new QuestionSelector(repo),
      variants,
      grader: new Grader(new InProcessSandboxRunner()),
      settings: new StaticSettings(),
    });
    const r = await plain.issue({ player: 'p', rewardKey: 'heal:small' });
    expect(r.ok).toBe(true);
    plain.abandon('p');
  });
});

describe('the hint ladder (16.3)', () => {
  const card = {
    topic: 'where',
    title: 'WHERE: filter rows',
    nudge: 'WHERE keeps only matching rows.',
    body_md: 'Use conditions.',
  };
  const build = (
    freeHintSteps: number,
    concepts: StaticConcepts | null = new StaticConcepts([card]),
  ) => {
    const repo = new InMemoryQuestionRepository();
    repo.create(base, null); // topics: select, where
    const sink = new MemorySink();
    const svc = new ChallengeService({
      matchSeed: 'm',
      selector: new QuestionSelector(repo),
      variants,
      grader: new Grader(new InProcessSandboxRunner()),
      settings: new StaticSettings({ ...DEFAULT_CHALLENGE_SETTINGS, freeHintSteps }),
      now: () => 1_000_000,
      newId: () => 'c1',
      attempts: sink,
      ...(concepts ? { concepts } : {}),
    });
    return { svc, sink };
  };
  const issue = async (svc: ChallengeService, over: object = {}) => {
    const r = await svc.issue({ player: 'p', rewardKey: 'heal:small', ...over });
    if (!r.ok) throw new Error(r.reason);
    return r.challenge;
  };

  it('starts with a free nudge, then the free concept card, then the question’s paid hint', async () => {
    const { svc } = build(2);
    const c = await issue(svc);
    expect(c.hintCosts).toEqual([0, 0, 0.05]);
    const steps = [0, 1, 2].map((i) => svc.hint('p', c.id, i));
    expect(steps.map((s) => s.ok && s.hint.text)).toEqual([
      card.nudge,
      'WHERE: filter rows\nUse conditions.',
      'Combine two conditions with AND.',
    ]);
    expect(steps.map((s) => s.ok && s.hint.cost)).toEqual([0, 0, 0.05]);
    expect(svc.hint('p', c.id, 3)).toMatchObject({ ok: false, reason: 'no_such_hint' });
  });

  it('opens steps in order', async () => {
    const { svc } = build(2);
    const c = await issue(svc);
    expect(svc.hint('p', c.id, 1)).toMatchObject({ ok: false, reason: 'out_of_order' });
  });

  it('follows the setting: none, only the nudge, or both', async () => {
    expect((await issue(build(0).svc)).hintCosts).toEqual([0.05]);
    expect((await issue(build(1).svc)).hintCosts).toEqual([0, 0.05]);
    expect((await issue(build(2).svc)).hintCosts).toEqual([0, 0, 0.05]);
  });

  it('adds nothing when the topic has no card, or there are no cards at all', async () => {
    expect(
      (await issue(build(2, new StaticConcepts([{ ...card, topic: 'window' }])).svc)).hintCosts,
    ).toEqual([0.05]);
    expect((await issue(build(2, null).svc)).hintCosts).toEqual([0.05]);
  });

  it('counts only the paid steps against the profile', async () => {
    const { svc, sink } = build(2);
    const c = await issue(svc);
    for (const i of [0, 1]) svc.hint('p', c.id, i); // both free
    svc.abandon('p');
    expect(sink.items.at(-1)?.item.hintsPaid).toBe(0);
    const again = await issue(svc, { player: 'q' });
    for (const i of [0, 1, 2]) svc.hint('q', again.id, i);
    svc.abandon('q');
    expect(sink.items.at(-1)?.item.hintsPaid).toBe(1);
  });

  it('keeps every step free in the tutorial', async () => {
    const { svc } = build(2);
    expect((await issue(svc, { revealSolution: true })).hintCosts).toEqual([0, 0, 0]);
  });
});

describe('review material on an item (16.2)', () => {
  it('carries the student’s last query and the model answer, for the review only', async () => {
    const sink2 = new MemorySink();
    const repo = new InMemoryQuestionRepository();
    repo.create(base, null);
    const svc = new ChallengeService({
      matchSeed: 'm',
      selector: new QuestionSelector(repo),
      variants,
      grader: new Grader(new InProcessSandboxRunner()),
      settings: new StaticSettings(),
      now: () => 1_000_000,
      attempts: sink2,
    });
    const r = await svc.issue({ player: 'p1', rewardKey: 'heal:small' });
    if (!r.ok) throw new Error(r.reason);
    await svc.submit('p1', r.challenge.id, 'SELECT 1');
    svc.abandon('p1');
    const done = sink2.items[0];
    expect(done?.item.review).toMatchObject({ title: base.title, lastSql: 'SELECT 1' });
    expect(done?.item.review?.modelSql).toMatch(/^SELECT name FROM employees/);
    expect(done?.who.playerKey).toBe('p1');
  });
});

describe('skill-scaled difficulty (16.7)', () => {
  const tierQ = (slug: string, tier: number) => ({
    ...base,
    slug,
    tier,
    rcsbe: 'S' as const,
    topic: ['select'],
  });
  const build = () => {
    const repo = new InMemoryQuestionRepository();
    for (const t of [1, 2, 3, 4, 5]) repo.create(tierQ(`t${t}`, t), null);
    return new ChallengeService({
      matchSeed: 'm',
      selector: new QuestionSelector(repo),
      variants,
      grader: new Grader(new InProcessSandboxRunner()),
      settings: new StaticSettings(),
      now: () => 1_000_000,
    });
  };

  it('gives a struggling student an easier question and more time, for the hardest reward too', async () => {
    const svc = build();
    const normal = await svc.issue({ player: 'a', rewardKey: 'gun:sniper' });
    const eased = await svc.issue({
      player: 'b',
      rewardKey: 'gun:sniper',
      skill: { tierShift: -2, ttlScale: 1.6, rewardScale: 0.6 },
    });
    if (!normal.ok || !eased.ok) throw new Error('issue failed');
    expect(normal.challenge.tier).toBe(5);
    expect(eased.challenge.tier).toBe(3);
    expect(eased.challenge.expiresAt - 1_000_000).toBe(
      DEFAULT_CHALLENGE_SETTINGS.ttlSec * 1.6 * 1000,
    );
    expect(normal.challenge.expiresAt - 1_000_000).toBe(DEFAULT_CHALLENGE_SETTINGS.ttlSec * 1000);
  });

  it('every reward type stays possible at the largest shift (a beginner can earn each one)', async () => {
    const svc = build();
    for (const [i, reward] of [
      'heal:small',
      'heal:full',
      'ammo:refill',
      'gun:pistol',
      'gun:rifle',
      'gun:sniper',
    ].entries()) {
      const r = await svc.issue({
        player: `p${i}`,
        rewardKey: reward,
        skill: { tierShift: -2, ttlScale: 1.6, rewardScale: 0.6 },
      });
      expect(r.ok, reward).toBe(true);
    }
  });

  it('never eases a fixed question (the tutorial)', async () => {
    const svc = build();
    const r = await svc.issue({
      player: 'a',
      rewardKey: 'gun:sniper',
      fixed: { slug: 't5', seed: 's' },
      skill: { tierShift: -2, ttlScale: 1.6, rewardScale: 0.6 },
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.challenge.tier).toBe(5);
  });
});
