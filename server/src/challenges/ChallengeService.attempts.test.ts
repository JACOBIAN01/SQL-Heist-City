import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_SETTINGS, questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { MemorySink } from '../analytics/AttemptSink';
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
    expect(sink.items[0]?.who).toEqual(who);
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
