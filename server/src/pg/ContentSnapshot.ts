import type { DatabaseSync } from 'node:sqlite';
import type { PgDatabase } from './PgDatabase';

export interface SnapshotCounts {
  readonly questions: number;
  readonly settings: number;
  readonly rewards: number;
  readonly concepts: number;
}

/**
 * Copies the content the game reads (questions, topics, settings, reward map)
 * from PostgreSQL into a local SQLite database, in one transaction.
 *
 * Pattern: Read model (snapshot) — Why: PostgreSQL is the system of record,
 * but the 20 Hz game loop and the challenge code read synchronously. Match
 * servers read this local copy, which the admin's reload refreshes, so no
 * tick ever waits on a network database and the game code is unchanged.
 */
export async function syncContent(pg: PgDatabase, target: DatabaseSync): Promise<SnapshotCounts> {
  const questions = await pg.query<{
    id: string;
    slug: string;
    tier: number;
    title: string;
    enabled: boolean;
    current_version: number;
    template_json: unknown;
    updated_by: string | null;
    updated_at: Date;
  }>('SELECT * FROM questions WHERE deleted_at IS NULL ORDER BY id');
  const topics = await pg.query<{ question_id: string; topic: string }>(
    'SELECT question_id, topic FROM question_topics',
  );
  const settings = await pg.query<{ key: string; value_json: unknown }>(
    'SELECT key, value_json FROM settings',
  );
  const rewards = await pg.query<{ reward_key: string; tier_min: number; tier_max: number }>(
    'SELECT * FROM reward_map',
  );

  const concepts = await pg.query<{
    topic: string;
    title: string;
    nudge: string;
    body_md: string;
    version: number;
    updated_by: string | null;
    updated_at: Date;
  }>('SELECT * FROM concept_cards');

  target.exec('BEGIN');
  try {
    for (const table of [
      'pool_questions',
      'question_topics',
      'question_versions',
      'questions',
      'settings',
      'reward_map',
      'concept_cards',
    ])
      target.exec(`DELETE FROM ${table}`);
    const insertQuestion = target.prepare(
      `INSERT INTO questions (id, slug, tier, title, enabled, current_version, template_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const q of questions)
      insertQuestion.run(
        Number(q.id),
        q.slug,
        q.tier,
        q.title,
        q.enabled ? 1 : 0,
        q.current_version,
        JSON.stringify(q.template_json),
        q.updated_by,
        q.updated_at.toISOString(),
      );
    const insertTopic = target.prepare('INSERT INTO question_topics VALUES (?, ?)');
    const known = new Set(questions.map((q) => Number(q.id)));
    for (const t of topics)
      if (known.has(Number(t.question_id))) insertTopic.run(Number(t.question_id), t.topic);
    const insertSetting = target.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)');
    for (const s of settings) insertSetting.run(s.key, JSON.stringify(s.value_json));
    const insertReward = target.prepare(
      'INSERT INTO reward_map (reward_key, tier_min, tier_max) VALUES (?, ?, ?)',
    );
    for (const r of rewards) insertReward.run(r.reward_key, r.tier_min, r.tier_max);
    const insertConcept = target.prepare(
      'INSERT INTO concept_cards (topic, title, nudge, body_md, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const c of concepts)
      insertConcept.run(
        c.topic,
        c.title,
        c.nudge,
        c.body_md,
        c.version,
        c.updated_by,
        c.updated_at.toISOString(),
      );
    target.exec('COMMIT');
  } catch (err) {
    target.exec('ROLLBACK');
    throw err;
  }
  return {
    questions: questions.length,
    settings: settings.length,
    rewards: rewards.length,
    concepts: concepts.length,
  };
}
