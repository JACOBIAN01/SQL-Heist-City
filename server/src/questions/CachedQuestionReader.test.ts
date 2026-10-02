import { describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { StaticSettings } from '../config/SettingsReader';
import { CachedSettingsReader } from '../config/CachedSettingsReader';
import { CachedQuestionReader } from './CachedQuestionReader';
import { InMemoryQuestionRepository } from './InMemoryQuestionRepository';

const base = questionTemplateSchema.parse(sampleQuestion);

describe('CachedQuestionReader', () => {
  it('serves cached lists until invalidated', () => {
    const repo = new InMemoryQuestionRepository();
    const cached = new CachedQuestionReader(repo);
    repo.create(base, null);
    expect(cached.list({ enabled: true })).toHaveLength(1);
    repo.create({ ...base, slug: 'second' }, null);
    expect(cached.list({ enabled: true })).toHaveLength(1);
    expect(cached.list({ enabled: false })).toHaveLength(0);
    cached.invalidate();
    expect(cached.list({ enabled: true })).toHaveLength(2);
  });
});

describe('CachedSettingsReader', () => {
  it('caches settings and reward tiers until invalidated', () => {
    let calls = 0;
    const inner = new StaticSettings();
    const counting = {
      challengeSettings: () => (calls++, inner.challengeSettings()),
      rewardTiers: (k: string) => (calls++, inner.rewardTiers(k)),
    };
    const cached = new CachedSettingsReader(counting);
    cached.challengeSettings();
    cached.challengeSettings();
    cached.rewardTiers('gun:laser');
    cached.rewardTiers('gun:laser');
    expect(calls).toBe(2);
    cached.invalidate();
    cached.challengeSettings();
    expect(calls).toBe(3);
  });
});
