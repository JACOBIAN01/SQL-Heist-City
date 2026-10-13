import type { DatabaseSync } from 'node:sqlite';
import type { ConceptCard, StoredConcept } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

export interface ConceptVersion extends ConceptCard {
  readonly version: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

// Pattern: Repository (async) — Why: the admin edits cards on SQLite or PostgreSQL behind one contract;
// the game reads a snapshot through the synchronous ConceptReader below.
export interface ConceptStore {
  list(): Promise<StoredConcept[]>;
  get(topic: string): Promise<StoredConcept | undefined>;
  /** Creates the card, or saves a new version of it; history is kept. */
  save(card: ConceptCard, actor: string | null): Promise<StoredConcept>;
  versions(topic: string): Promise<ConceptVersion[]>;
}

/** What the running game needs: look a card up by topic, no waiting. */
export interface ConceptReader {
  get(topic: string): StoredConcept | undefined;
}

export class NoConcepts implements ConceptReader {
  get(): undefined {
    return undefined;
  }
}

/** A fixed set of cards (tests and tools). */
export class StaticConcepts implements ConceptReader {
  private readonly byTopic: Map<string, StoredConcept>;

  constructor(cards: readonly ConceptCard[]) {
    this.byTopic = new Map(
      cards.map((c) => [c.topic, { ...c, version: 1, updatedAt: '', updatedBy: null }]),
    );
  }

  get(topic: string) {
    return this.byTopic.get(topic);
  }
}

interface SqliteRow {
  topic: string;
  title: string;
  nudge: string;
  body_md: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

const fromSqlite = (r: SqliteRow): StoredConcept => ({
  topic: r.topic,
  title: r.title,
  nudge: r.nudge,
  body_md: r.body_md,
  version: r.version,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** The game's own read-only view of the cards in its snapshot database. */
export class SqliteConceptReader implements ConceptReader {
  private cache = new Map<string, StoredConcept | undefined>();

  constructor(private readonly db: DatabaseSync) {}

  get(topic: string): StoredConcept | undefined {
    if (!this.cache.has(topic)) {
      const row = this.db.prepare('SELECT * FROM concept_cards WHERE topic = ?').get(topic) as
        SqliteRow | undefined;
      this.cache.set(topic, row && fromSqlite(row));
    }
    return this.cache.get(topic);
  }

  invalidate(): void {
    this.cache = new Map();
  }
}

export class SqliteConceptStore implements ConceptStore {
  constructor(private readonly db: DatabaseSync) {}

  async list() {
    const rows = this.db
      .prepare('SELECT * FROM concept_cards ORDER BY topic')
      .all() as unknown as SqliteRow[];
    return rows.map(fromSqlite);
  }

  async get(topic: string) {
    const row = this.db.prepare('SELECT * FROM concept_cards WHERE topic = ?').get(topic) as
      SqliteRow | undefined;
    return row && fromSqlite(row);
  }

  async save(card: ConceptCard, actor: string | null) {
    this.db.exec('BEGIN');
    try {
      const current = this.db
        .prepare('SELECT version FROM concept_cards WHERE topic = ?')
        .get(card.topic) as { version: number } | undefined;
      const version = (current?.version ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO concept_cards (topic, title, nudge, body_md, version, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ${NOW})
           ON CONFLICT (topic) DO UPDATE SET title = excluded.title, nudge = excluded.nudge,
             body_md = excluded.body_md, version = excluded.version, updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .run(card.topic, card.title, card.nudge, card.body_md, version, actor);
      this.db
        .prepare(
          'INSERT INTO concept_card_versions (topic, version, title, nudge, body_md, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(card.topic, version, card.title, card.nudge, card.body_md, actor);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return (await this.get(card.topic)) as StoredConcept;
  }

  async versions(topic: string) {
    const rows = this.db
      .prepare('SELECT * FROM concept_card_versions WHERE topic = ? ORDER BY version')
      .all(topic) as unknown as (SqliteRow & { created_by: string | null; created_at: string })[];
    return rows.map((r) => ({
      topic: r.topic,
      title: r.title,
      nudge: r.nudge,
      body_md: r.body_md,
      version: r.version,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  }
}

interface PgRow {
  topic: string;
  title: string;
  nudge: string;
  body_md: string;
  version: number;
  updated_by: string | null;
  updated_at: Date;
  [column: string]: unknown;
}

const fromPg = (r: PgRow): StoredConcept => ({
  topic: r.topic,
  title: r.title,
  nudge: r.nudge,
  body_md: r.body_md,
  version: r.version,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at.toISOString(),
});

export class PgConceptStore implements ConceptStore {
  constructor(private readonly db: PgDatabase) {}

  async list() {
    return (await this.db.query<PgRow>('SELECT * FROM concept_cards ORDER BY topic')).map(fromPg);
  }

  async get(topic: string) {
    const row = await this.db.one<PgRow>('SELECT * FROM concept_cards WHERE topic = $1', [topic]);
    return row && fromPg(row);
  }

  async save(card: ConceptCard, actor: string | null) {
    return this.db.tx(async (tx) => {
      const row = await tx.one<PgRow>(
        `INSERT INTO concept_cards (topic, title, nudge, body_md, version, updated_by)
         VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (topic) DO UPDATE SET title = excluded.title, nudge = excluded.nudge,
           body_md = excluded.body_md, version = concept_cards.version + 1,
           updated_by = excluded.updated_by, updated_at = now()
         RETURNING *`,
        [card.topic, card.title, card.nudge, card.body_md, actor],
      );
      const saved = row as PgRow;
      await tx.query(
        'INSERT INTO concept_card_versions (topic, version, title, nudge, body_md, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [card.topic, saved.version, card.title, card.nudge, card.body_md, actor],
      );
      return fromPg(saved);
    });
  }

  async versions(topic: string) {
    const rows = await this.db.query<PgRow & { created_by: string | null; created_at: Date }>(
      'SELECT * FROM concept_card_versions WHERE topic = $1 ORDER BY version',
      [topic],
    );
    return rows.map((r) => ({
      topic: r.topic,
      title: r.title,
      nudge: r.nudge,
      body_md: r.body_md,
      version: r.version,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
