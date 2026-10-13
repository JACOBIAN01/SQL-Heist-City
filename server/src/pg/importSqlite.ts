import type { DatabaseSync } from 'node:sqlite';
import type { PgDatabase, PgTx } from './PgDatabase';

export interface ImportCounts {
  readonly [table: string]: number;
}

type Row = Record<string, unknown>;

const rows = (db: DatabaseSync, sql: string): Row[] => db.prepare(sql).all() as unknown as Row[];
const json = (text: unknown): unknown => (typeof text === 'string' ? JSON.parse(text) : null);
const iso = (text: unknown): string | null => (typeof text === 'string' ? text : null);

/**
 * One-shot copy of a SQLite `dev.db` into an empty PostgreSQL schema, keeping
 * every id so versions, topics, pools and the audit trail still point at the
 * right rows. Refuses to run when the target already holds questions or users.
 * Sessions are not copied (everyone logs in again).
 */
export async function importSqlite(
  source: DatabaseSync,
  target: PgDatabase,
): Promise<ImportCounts> {
  return target.tx(async (tx) => {
    const existing = await tx.one<{ n: string }>(
      'SELECT (SELECT count(*) FROM questions) + (SELECT count(*) FROM users) AS n',
    );
    if (Number(existing?.n) > 0)
      throw new Error('target database is not empty; refusing to import');
    const counts: Record<string, number> = {};
    const copy = async (
      table: string,
      sourceRows: Row[],
      columns: string[],
      convert: (r: Row) => unknown[],
      identity = false,
    ) => {
      for (const r of sourceRows) {
        const marks = columns.map((_, i) => `$${i + 1}`).join(', ');
        await tx.query(
          `INSERT INTO ${table} (${columns.join(', ')}) ${identity ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES (${marks})`,
          convert(r),
        );
      }
      counts[table] = sourceRows.length;
      if (identity) await resetSequence(tx, table);
    };

    await copy(
      'questions',
      rows(source, 'SELECT * FROM questions ORDER BY id'),
      [
        'id',
        'slug',
        'tier',
        'title',
        'enabled',
        'current_version',
        'template_json',
        'updated_by',
        'created_at',
        'updated_at',
        'deleted_at',
      ],
      (r) => [
        r.id,
        r.slug,
        r.tier,
        r.title,
        r.enabled === 1,
        r.current_version,
        json(r.template_json),
        r.updated_by,
        iso(r.created_at),
        iso(r.updated_at),
        iso(r.deleted_at),
      ],
      true,
    );
    await copy(
      'question_topics',
      rows(source, 'SELECT * FROM question_topics'),
      ['question_id', 'topic'],
      (r) => [r.question_id, r.topic],
    );
    await copy(
      'question_versions',
      rows(source, 'SELECT * FROM question_versions ORDER BY id'),
      ['id', 'question_id', 'version', 'template_json', 'created_by', 'created_at'],
      (r) => [
        r.id,
        r.question_id,
        r.version,
        json(r.template_json),
        r.created_by,
        iso(r.created_at),
      ],
      true,
    );
    await copy(
      'reward_map',
      rows(source, 'SELECT * FROM reward_map'),
      ['reward_key', 'tier_min', 'tier_max'],
      (r) => [r.reward_key, r.tier_min, r.tier_max],
    );
    await copy('settings', rows(source, 'SELECT * FROM settings'), ['key', 'value_json'], (r) => [
      r.key,
      json(r.value_json),
    ]);
    await copy(
      'users',
      rows(source, 'SELECT * FROM users ORDER BY id'),
      ['id', 'email', 'password_hash', 'role', 'disabled', 'created_at'],
      (r) => [r.id, r.email, r.password_hash, r.role, r.disabled === 1, iso(r.created_at)],
      true,
    );
    await copy(
      'audit_log',
      rows(source, 'SELECT * FROM audit_log ORDER BY id'),
      ['id', 'user_id', 'actor', 'action', 'entity', 'entity_id', 'detail_json', 'at'],
      (r) => [
        r.id,
        r.user_id,
        r.actor,
        r.action,
        r.entity,
        r.entity_id,
        json(r.detail_json),
        iso(r.at),
      ],
      true,
    );
    await copy(
      'pools',
      rows(source, 'SELECT * FROM pools ORDER BY id'),
      ['id', 'name', 'description', 'created_by', 'created_at', 'updated_at'],
      (r) => [r.id, r.name, r.description, r.created_by, iso(r.created_at), iso(r.updated_at)],
      true,
    );
    await copy(
      'pool_questions',
      rows(source, 'SELECT * FROM pool_questions'),
      ['pool_id', 'question_id'],
      (r) => [r.pool_id, r.question_id],
    );
    return counts;
  });
}

/** After inserting explicit ids, new rows must continue after the largest. */
async function resetSequence(tx: PgTx, table: string): Promise<void> {
  await tx.query(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT max(id) FROM ${table}), 0) + 1, false)`,
  );
}
