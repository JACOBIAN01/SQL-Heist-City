import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { SqliteSettingsReader } from '../config/SettingsReader';
import { PgConceptStore, SqliteConceptReader } from '../concepts/ConceptStore';
import { PgSettingsStore } from '../config/SettingsStore';
import { openDatabase } from '../db/database';
import { PgQuestionStore } from '../questions/PgQuestionStore';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { syncContent } from './ContentSnapshot';
import type { PgDatabase } from './PgDatabase';
import { TEST_DATABASE_URL, freshPg } from './testing';

describe.skipIf(!TEST_DATABASE_URL)('content snapshot', () => {
  let pg: PgDatabase;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db: pg, drop } = await freshPg()));
  afterAll(() => drop());

  it('copies questions, topics, settings and rewards, and a refresh replaces them', async () => {
    const questions = new PgQuestionStore(pg);
    const settings = new PgSettingsStore(pg);
    const base = questionTemplateSchema.parse(sampleQuestion);
    const keep = await questions.create({ ...base, slug: 'keep', topic: ['joins'] }, 'a');
    const gone = await questions.create({ ...base, slug: 'gone' }, 'a');
    await questions.remove(gone.id, 'a');
    await settings.put('heist', { killBonus: 77 });
    await settings.applyRewards([{ key: 'gun:rifle', override: { min: 2, max: 3 } }]);
    await new PgConceptStore(pg).save(
      { topic: 'joins', title: 'Joins', nudge: 'Match rows.', body_md: 'ON links tables.' },
      'a',
    );

    const local = openDatabase({ path: ':memory:' });
    expect(await syncContent(pg, local)).toEqual({
      questions: 1,
      settings: 1,
      rewards: 1,
      concepts: 1,
    });
    expect(new SqliteConceptReader(local).get('joins')?.nudge).toBe('Match rows.');
    const repo = new SqliteQuestionRepository(local);
    expect(repo.list().map((q) => q.slug)).toEqual(['keep']);
    expect(repo.getById(keep.id)?.template.topic).toEqual(['joins']);
    expect(repo.list({ topic: 'joins' }).length).toBe(1);
    const reader = new SqliteSettingsReader(local);
    expect(reader.heistSettings().killBonus).toBe(77);
    expect(reader.rewardTiers('gun:rifle')).toEqual({ min: 2, max: 3 });

    await questions.update(keep.id, { ...base, slug: 'keep', title: 'Renamed' }, 'a');
    await settings.put('heist', { killBonus: 5 });
    await syncContent(pg, local);
    expect(repo.getBySlug('keep')?.template.title).toBe('Renamed');
    expect(reader.heistSettings().killBonus).toBe(5);
  });
});
