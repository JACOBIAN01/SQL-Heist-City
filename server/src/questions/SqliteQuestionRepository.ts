import type { DatabaseSync } from 'node:sqlite';
import { questionTemplateSchema, type QuestionTemplate } from '@heist/shared';
import {
  DuplicateSlugError,
  QuestionNotFoundError,
  type QuestionFilter,
  type QuestionRepository,
  type QuestionVersion,
  type StoredQuestion,
} from './QuestionRepository';

interface QuestionRow {
  id: number;
  slug: string;
  current_version: number;
  enabled: number;
  template_json: string;
  updated_at: string;
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** SQLite-backed question store. Pass a read-only handle when only QuestionReader is needed. */
export class SqliteQuestionRepository implements QuestionRepository {
  constructor(private readonly db: DatabaseSync) {}

  getById(id: number): StoredQuestion | undefined {
    const row = this.db
      .prepare('SELECT * FROM questions WHERE id = ? AND deleted_at IS NULL')
      .get(id) as QuestionRow | undefined;
    return row && toStored(row);
  }

  getBySlug(slug: string): StoredQuestion | undefined {
    const row = this.db
      .prepare('SELECT * FROM questions WHERE slug = ? AND deleted_at IS NULL')
      .get(slug) as QuestionRow | undefined;
    return row && toStored(row);
  }

  list(filter: QuestionFilter = {}): StoredQuestion[] {
    const where = ['deleted_at IS NULL'];
    const args: (number | string)[] = [];
    if (filter.tierMin !== undefined) {
      where.push('tier >= ?');
      args.push(filter.tierMin);
    }
    if (filter.tierMax !== undefined) {
      where.push('tier <= ?');
      args.push(filter.tierMax);
    }
    if (filter.enabled !== undefined) {
      where.push('enabled = ?');
      args.push(filter.enabled ? 1 : 0);
    }
    if (filter.topic !== undefined) {
      where.push('id IN (SELECT question_id FROM question_topics WHERE topic = ?)');
      args.push(filter.topic);
    }
    const rows = this.db
      .prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY id`)
      .all(...args) as unknown as QuestionRow[];
    return rows.map(toStored);
  }

  create(template: QuestionTemplate, actor: string | null): StoredQuestion {
    return this.transaction(() => {
      this.assertSlugFree(template.slug, null);
      const json = JSON.stringify(template);
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO questions (slug, tier, title, enabled, template_json, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(template.slug, template.tier, template.title, template.enabled ? 1 : 0, json, actor);
      const id = Number(lastInsertRowid);
      this.writeTopics(id, template.topic);
      this.writeVersion(id, 1, json, actor);
      return this.mustGet(id);
    });
  }

  update(id: number, template: QuestionTemplate, actor: string | null): StoredQuestion {
    return this.transaction(() => {
      const current = this.mustGet(id);
      this.assertSlugFree(template.slug, id);
      const version = current.version + 1;
      const json = JSON.stringify(template);
      this.db
        .prepare(
          `UPDATE questions SET slug = ?, tier = ?, title = ?, enabled = ?, template_json = ?,
             current_version = ?, updated_by = ?, updated_at = ${NOW}
           WHERE id = ?`,
        )
        .run(
          template.slug,
          template.tier,
          template.title,
          template.enabled ? 1 : 0,
          json,
          version,
          actor,
          id,
        );
      this.writeTopics(id, template.topic);
      this.writeVersion(id, version, json, actor);
      return this.mustGet(id);
    });
  }

  setEnabled(id: number, enabled: boolean, actor: string | null): StoredQuestion {
    const current = this.mustGet(id);
    if (current.enabled === enabled) return current;
    return this.update(id, { ...current.template, enabled }, actor);
  }

  remove(id: number, actor: string | null): void {
    this.mustGet(id);
    this.db
      .prepare(`UPDATE questions SET deleted_at = ${NOW}, updated_by = ? WHERE id = ?`)
      .run(actor, id);
  }

  versions(id: number): QuestionVersion[] {
    this.mustGet(id);
    const rows = this.db
      .prepare(
        `SELECT version, template_json, created_by, created_at FROM question_versions
         WHERE question_id = ? ORDER BY version`,
      )
      .all(id) as unknown as {
      version: number;
      template_json: string;
      created_by: string | null;
      created_at: string;
    }[];
    return rows.map((r) => ({
      version: r.version,
      template: parseTemplate(r.template_json),
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  }

  private mustGet(id: number): StoredQuestion {
    const q = this.getById(id);
    if (!q) throw new QuestionNotFoundError(id);
    return q;
  }

  private assertSlugFree(slug: string, exceptId: number | null): void {
    // Deleted questions keep their slug (UNIQUE), so check all rows.
    const row = this.db.prepare('SELECT id FROM questions WHERE slug = ?').get(slug) as
      { id: number } | undefined;
    if (row && row.id !== exceptId) throw new DuplicateSlugError(slug);
  }

  private writeTopics(id: number, topics: readonly string[]): void {
    this.db.prepare('DELETE FROM question_topics WHERE question_id = ?').run(id);
    const insert = this.db.prepare('INSERT OR IGNORE INTO question_topics VALUES (?, ?)');
    for (const topic of topics) insert.run(id, topic);
  }

  private writeVersion(id: number, version: number, json: string, actor: string | null): void {
    this.db
      .prepare(
        'INSERT INTO question_versions (question_id, version, template_json, created_by) VALUES (?, ?, ?, ?)',
      )
      .run(id, version, json, actor);
  }

  private transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
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

function toStored(row: QuestionRow): StoredQuestion {
  return {
    id: row.id,
    slug: row.slug,
    version: row.current_version,
    enabled: row.enabled === 1,
    template: parseTemplate(row.template_json),
    updatedAt: row.updated_at,
  };
}

/** Re-validate on read so a hand-edited row can't feed bad data to the game. */
function parseTemplate(json: string): QuestionTemplate {
  return questionTemplateSchema.parse(JSON.parse(json));
}
