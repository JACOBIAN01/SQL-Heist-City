import { beforeEach, describe, expect, it } from 'vitest';
import { SeededRng, questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { InMemoryQuestionRepository } from '../questions/InMemoryQuestionRepository';
import { QuestionSelector } from './QuestionSelector';

const base = questionTemplateSchema.parse(sampleQuestion);
let repo: InMemoryQuestionRepository;
let selector: QuestionSelector;
const rng = new SeededRng('selector');

function add(slug: string, tier: number, enabled = true) {
  return repo.create({ ...base, slug, tier, enabled }, null);
}

beforeEach(() => {
  repo = new InMemoryQuestionRepository();
  selector = new QuestionSelector(repo);
});

const pick = (player = 'p1', reward = 'heal:small', min = 1, max = 1) =>
  selector.select(player, reward, { min, max }, rng)?.slug;

describe('QuestionSelector', () => {
  it('only picks enabled questions in the tier range', () => {
    add('t1', 1);
    add('t2', 2);
    add('t1-off', 1, false);
    for (let i = 0; i < 20; i++) expect(pick()).toBe('t1');
  });

  it('never repeats until the pool is exhausted, then restarts without an immediate repeat', () => {
    for (const s of ['a', 'b', 'c', 'd']) add(s, 1);
    const firstCycle = [pick(), pick(), pick(), pick()];
    expect(new Set(firstCycle).size).toBe(4);
    const nextAfterReset = pick();
    expect(nextAfterReset).not.toBe(firstCycle[3]);
  });

  it('keeps separate histories per player and per reward', () => {
    add('a', 1);
    add('b', 1);
    const p1 = [pick('p1'), pick('p1')];
    expect(new Set(p1).size).toBe(2);
    // p2 and another reward for p1 start fresh, independent of p1's heal history.
    expect(new Set([pick('p2'), pick('p2')]).size).toBe(2);
    expect(new Set([pick('p1', 'gun:pistol'), pick('p1', 'gun:pistol')]).size).toBe(2);
  });

  it('a one-question pool is reused rather than blocking the player', () => {
    add('only', 1);
    expect([pick(), pick(), pick()]).toEqual(['only', 'only', 'only']);
  });

  it('widens the tier range when the requested tiers are empty', () => {
    add('t3', 3);
    add('t5', 5);
    expect(pick('p1', 'gun:rifle', 4, 4)).toMatch(/^t[35]$/);
    expect(pick('p1', 'heal:small', 1, 1)).toBe('t3');
  });

  it('returns undefined when there are no enabled questions at all', () => {
    add('off', 1, false);
    expect(pick()).toBeUndefined();
  });

  it('forgetPlayer resets that player only', () => {
    add('a', 1);
    add('b', 1);
    const first = pick('p1');
    selector.forgetPlayer('p1');
    const seen = new Set([first, pick('p1'), pick('p1')]);
    expect(seen.size).toBe(2);
  });
});
