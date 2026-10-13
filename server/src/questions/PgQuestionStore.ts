import { parseStoredTemplate, type QuestionTemplate } from '@heist/shared';
import type { PgDatabase, PgTx } from '../pg/PgDatabase';
import { isUniqueViolation } from '../pg/PgDatabase';
import {
  DuplicateSlugError,
  QuestionNotFoundError,
  type QuestionFilter,
  type QuestionVersion,
  type StoredQuestion,
} from './QuestionRepository';
import type { QuestionStore } from './QuestionStore';

interface QuestionRow {
  id: string | number;
  slug: string;
  current_version: number;
  enabled: boolean;
  template_json: unknown;
  updated_at: Date;
  [column: string]: unknown;
}

/** The question store on PostgreSQL. Same contract as the SQLite repository (see the contract tests). */
export class PgQuestionStore implements QuestionStore {
  constructor(private readonly db: PgDatabase) {}

  async getById(id: number): Promise<StoredQuestion | undefined> {
    const row = await this.db.one<QuestionRow>(
      'SELECT * FROM questions WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    return row && toStored(row);
  }

  async getBySlug(slug: string): Promise<StoredQuestion | undefined> {
    const row = await this.db.one<QuestionRow>(
      'SELECT * FROM questions WHERE slug = $1 AND deleted_at IS NULL',
      [slug],
    );
    return row && toStored(row);
  }

  async list(filter: QuestionFilter = {}): Promise<StoredQuestion[]> {
    const where = ['deleted_at IS NULL'];
    const args: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      args.push(value);
      where.push(clause.replace('?', `$${args.length}`));
    };
    if (filter.tierMin !== undefined) add('tier >= ?', filter.tierMin);
    if (filter.tierMax !== undefined) add('tier <= ?', filter.tierMax);
    if (filter.enabled !== undefined) add('enabled = ?', filter.enabled);
    if (filter.topic !== undefined)
      add('id IN (SELECT question_id FROM question_topics WHERE topic = ?)', filter.topic);
    const rows = await this.db.query<QuestionRow>(
      `SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY id`,
      args,
    );
    return rows.map(toStored);
  }

  async create(template: QuestionTemplate, actor: string | null): Promise<StoredQuestion> {
    return this.db.tx(async (tx) => {
      let row: QuestionRow | undefined;
      try {
        row = await tx.one<QuestionRow>(
          `INSERT INTO questions (slug, tier, title, enabled, template_json, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [template.slug, template.tier, template.title, template.enabled, template, actor],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateSlugError(template.slug);
        throw err;
      }
      const id = Number((row as QuestionRow).id);
      await writeTopics(tx, id, template.topic);
      await writeVersion(tx, id, 1, template, actor);
      return toStored(row as QuestionRow);
    });
  }

  async update(
    id: number,
    template: QuestionTemplate,
    actor: string | null,
  ): Promise<StoredQuestion> {
    return this.db.tx(async (tx) => {
      const current = await tx.one<QuestionRow>(
        'SELECT * FROM questions WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      if (!current) throw new QuestionNotFoundError(id);
      const version = current.current_version + 1;
      let row: QuestionRow | undefined;
      try {
        row = await tx.one<QuestionRow>(
          `UPDATE questions SET slug = $1, tier = $2, title = $3, enabled = $4, template_json = $5,
             current_version = $6, updated_by = $7, updated_at = now()
           WHERE id = $8 RETURNING *`,
          [
            template.slug,
            template.tier,
            template.title,
            template.enabled,
            template,
            version,
            actor,
            id,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateSlugError(template.slug);
        throw err;
      }
      await writeTopics(tx, id, template.topic);
      await writeVersion(tx, id, version, template, actor);
      return toStored(row as QuestionRow);
    });
  }

  async setEnabled(id: number, enabled: boolean, actor: string | null): Promise<StoredQuestion> {
    const current = await this.mustGet(id);
    if (current.enabled === enabled) return current;
    return this.update(id, { ...current.template, enabled }, actor);
  }

  async remove(id: number, actor: string | null): Promise<void> {
    await this.mustGet(id);
    await this.db.query('UPDATE questions SET deleted_at = now(), updated_by = $1 WHERE id = $2', [
      actor,
      id,
    ]);
  }

  async versions(id: number): Promise<QuestionVersion[]> {
    await this.mustGet(id);
    const rows = await this.db.query<{
      version: number;
      template_json: unknown;
      created_by: string | null;
      created_at: Date;
    }>(
      `SELECT version, template_json, created_by, created_at FROM question_versions
       WHERE question_id = $1 ORDER BY version`,
      [id],
    );
    return rows.map((r) => ({
      version: r.version,
      template: parseStoredTemplate(r.template_json),
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    }));
  }

  private async mustGet(id: number): Promise<StoredQuestion> {
    const q = await this.getById(id);
    if (!q) throw new QuestionNotFoundError(id);
    return q;
  }
}

async function writeTopics(tx: PgTx, id: number, topics: readonly string[]): Promise<void> {
  await tx.query('DELETE FROM question_topics WHERE question_id = $1', [id]);
  for (const topic of new Set(topics))
    await tx.query('INSERT INTO question_topics VALUES ($1, $2)', [id, topic]);
}

async function writeVersion(
  tx: PgTx,
  id: number,
  version: number,
  template: QuestionTemplate,
  actor: string | null,
): Promise<void> {
  await tx.query(
    'INSERT INTO question_versions (question_id, version, template_json, created_by) VALUES ($1, $2, $3, $4)',
    [id, version, template, actor],
  );
}

/** Re-validated on read, like the SQLite store, so a hand-edited row cannot feed bad data to the game. */
function toStored(row: QuestionRow): StoredQuestion {
  return {
    id: Number(row.id),
    slug: row.slug,
    version: row.current_version,
    enabled: row.enabled,
    template: parseStoredTemplate(row.template_json),
    updatedAt: row.updated_at.toISOString(),
  };
}
