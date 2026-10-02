import type { DatabaseSync } from 'node:sqlite';
import type { Pool } from '@heist/shared';

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

/** Named question sets (e.g. "Week 3: JOINs") a teacher can assign to a match. */
export class SqlitePoolRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Pool[] {
    const rows = this.db.prepare('SELECT * FROM pools ORDER BY name').all() as unknown as PoolRow[];
    return rows.map((r) => this.toPool(r));
  }

  get(id: number): Pool | undefined {
    const row = this.db.prepare('SELECT * FROM pools WHERE id = ?').get(id) as PoolRow | undefined;
    return row && this.toPool(row);
  }

  create(data: PoolData, actor: string): Pool {
    return this.tx(() => {
      this.assertNameFree(data.name, null);
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO pools (name, description, created_by) VALUES (?, ?, ?)')
        .run(data.name, data.description, actor);
      const id = Number(lastInsertRowid);
      this.setQuestions(id, data.questionIds);
      return this.get(id) as Pool;
    });
  }

  update(id: number, data: PoolData): Pool | undefined {
    if (!this.get(id)) return undefined;
    return this.tx(() => {
      this.assertNameFree(data.name, id);
      this.db
        .prepare(
          `UPDATE pools SET name = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        )
        .run(data.name, data.description, id);
      this.setQuestions(id, data.questionIds);
      return this.get(id) as Pool;
    });
  }

  remove(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM pools WHERE id = ?').run(id).changes) > 0;
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
