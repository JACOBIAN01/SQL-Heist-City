import type { DatabaseSync } from 'node:sqlite';
import type { Pool } from '@heist/shared';
import { isUniqueViolation, type PgDatabase, type PgTx } from '@heist/server/pg/PgDatabase';

export interface PoolData {
  readonly name: string;
  readonly description: string;
  readonly questionIds: readonly number[];
}

export class DuplicatePoolNameError extends Error {
  constructor(readonly poolName: string) {
    super(`a pool named "${poolName}" already exists`);
    this.name = 'DuplicatePoolNameError';
  }
}

export class UnknownQuestionsError extends Error {
  constructor(readonly ids: readonly number[]) {
    super(`unknown question ids: ${ids.join(', ')}`);
    this.name = 'UnknownQuestionsError';
  }
}

interface PoolRow {
  id: number;
  name: string;
  description: string;
  created_by: string | null;
  updated_at: string;
}

// Pattern: Repository (async) — Why: pools live on SQLite in development and PostgreSQL in production.
export interface PoolRepository {
  list(): Promise<Pool[]>;
  get(id: number): Promise<Pool | undefined>;
  /** Rejects with DuplicatePoolNameError or UnknownQuestionsError. */
  create(data: PoolData, actor: string): Promise<Pool>;
  update(id: number, data: PoolData): Promise<Pool | undefined>;
  remove(id: number): Promise<boolean>;
}

/** Named question sets (e.g. "Week 3: JOINs") a teacher can assign to a match. */
export class SqlitePoolRepository implements PoolRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<Pool[]> {
    const rows = this.db.prepare('SELECT * FROM pools ORDER BY name').all() as unknown as PoolRow[];
    return rows.map((r) => this.toPool(r));
  }

  async get(id: number): Promise<Pool | undefined> {
    const row = this.db.prepare('SELECT * FROM pools WHERE id = ?').get(id) as PoolRow | undefined;
    return row && this.toPool(row);
  }

  async create(data: PoolData, actor: string): Promise<Pool> {
    return this.tx(() => {
      this.assertNameFree(data.name, null);
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO pools (name, description, created_by) VALUES (?, ?, ?)')
        .run(data.name, data.description, actor);
      const id = Number(lastInsertRowid);
      this.setQuestions(id, data.questionIds);
      return this.read(id) as Pool;
    });
  }

  async update(id: number, data: PoolData): Promise<Pool | undefined> {
    if (!this.read(id)) return undefined;
    return this.tx(() => {
      this.assertNameFree(data.name, id);
      this.db
        .prepare(
          `UPDATE pools SET name = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        )
        .run(data.name, data.description, id);
      this.setQuestions(id, data.questionIds);
      return this.read(id) as Pool;
    });
  }

  async remove(id: number): Promise<boolean> {
    return Number(this.db.prepare('DELETE FROM pools WHERE id = ?').run(id).changes) > 0;
  }

  private read(id: number): Pool | undefined {
    const row = this.db.prepare('SELECT * FROM pools WHERE id = ?').get(id) as PoolRow | undefined;
    return row && this.toPool(row);
  }

  private setQuestions(poolId: number, ids: readonly number[]): void {
    const unique = [...new Set(ids)];
    const known = new Set(
      (
        this.db
          .prepare(
            `SELECT id FROM questions WHERE deleted_at IS NULL AND id IN (${unique.map(() => '?').join(',') || 'NULL'})`,
          )
          .all(...unique) as { id: number }[]
      ).map((r) => r.id),
    );
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length) throw new UnknownQuestionsError(missing);
    this.db.prepare('DELETE FROM pool_questions WHERE pool_id = ?').run(poolId);
    const insert = this.db.prepare('INSERT INTO pool_questions VALUES (?, ?)');
    for (const id of unique) insert.run(poolId, id);
  }

  private assertNameFree(name: string, exceptId: number | null): void {
    const row = this.db.prepare('SELECT id FROM pools WHERE name = ?').get(name) as
      { id: number } | undefined;
    if (row && row.id !== exceptId) throw new DuplicatePoolNameError(name);
  }

  private toPool(row: PoolRow): Pool {
    const ids = (
      this.db
        .prepare('SELECT question_id FROM pool_questions WHERE pool_id = ? ORDER BY question_id')
        .all(row.id) as {
        question_id: number;
      }[]
    ).map((r) => r.question_id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      questionIds: ids,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
    };
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Pools on PostgreSQL. */
export class PgPoolRepository implements PoolRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(): Promise<Pool[]> {
    const rows = await this.db.query<PgPoolRow>('SELECT * FROM pools ORDER BY lower(name)');
    return Promise.all(rows.map((r) => this.toPool(this.db, r)));
  }

  async get(id: number): Promise<Pool | undefined> {
    return this.read(this.db, id);
  }

  async create(data: PoolData, actor: string): Promise<Pool> {
    return this.db.tx(async (tx) => {
      let row: PgPoolRow | undefined;
      try {
        row = await tx.one<PgPoolRow>(
          'INSERT INTO pools (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
          [data.name, data.description, actor],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicatePoolNameError(data.name);
        throw err;
      }
      const id = Number((row as PgPoolRow).id);
      await this.setQuestions(tx, id, data.questionIds);
      return (await this.read(tx, id)) as Pool;
    });
  }

  async update(id: number, data: PoolData): Promise<Pool | undefined> {
    return this.db.tx(async (tx) => {
      if (!(await this.read(tx, id))) return undefined;
      try {
        await tx.query(
          'UPDATE pools SET name = $1, description = $2, updated_at = now() WHERE id = $3',
          [data.name, data.description, id],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicatePoolNameError(data.name);
        throw err;
      }
      await this.setQuestions(tx, id, data.questionIds);
      return this.read(tx, id);
    });
  }

  async remove(id: number): Promise<boolean> {
    const rows = await this.db.query('DELETE FROM pools WHERE id = $1 RETURNING id', [id]);
    return rows.length > 0;
  }

  private async read(db: Queryable, id: number): Promise<Pool | undefined> {
    const row = await db.one<PgPoolRow>('SELECT * FROM pools WHERE id = $1', [id]);
    return row && this.toPool(db, row);
  }

  private async setQuestions(tx: PgTx, poolId: number, ids: readonly number[]): Promise<void> {
    const unique = [...new Set(ids)];
    const known = new Set(
      (
        await tx.query<{ id: string }>(
          'SELECT id FROM questions WHERE deleted_at IS NULL AND id = ANY($1::bigint[])',
          [unique],
        )
      ).map((r) => Number(r.id)),
    );
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length) throw new UnknownQuestionsError(missing);
    await tx.query('DELETE FROM pool_questions WHERE pool_id = $1', [poolId]);
    for (const id of unique)
      await tx.query('INSERT INTO pool_questions VALUES ($1, $2)', [poolId, id]);
  }

  private async toPool(db: Queryable, row: PgPoolRow): Promise<Pool> {
    const ids = await db.query<{ question_id: string }>(
      'SELECT question_id FROM pool_questions WHERE pool_id = $1 ORDER BY question_id',
      [row.id],
    );
    return {
      id: Number(row.id),
      name: row.name,
      description: row.description,
      questionIds: ids.map((r) => Number(r.question_id)),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

interface PgPoolRow {
  id: string | number;
  name: string;
  description: string;
  created_by: string | null;
  updated_at: Date;
  [column: string]: unknown;
}

type Queryable = Pick<PgDatabase, 'query' | 'one'> | PgTx;
