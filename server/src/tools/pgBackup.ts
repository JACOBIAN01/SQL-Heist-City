import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PgDatabase, quoteIdent } from '../pg/PgDatabase';

/**
 * Backup and restore drill for PostgreSQL (Phase 20.3): `pg_dump` to a dated file, and a drill
 * that restores the file into a scratch database and checks it matches the source table by table.
 * A backup nobody has restored is not a backup.
 *   npm run backup:pg -w @heist/server -- backup --out backups --keep 14
 *   npm run backup:pg -w @heist/server -- drill
 * Reads DATABASE_URL. The password goes to the programs through the environment, never the command line.
 */

function pgBin(): string {
  const candidates = [process.env.PG_BIN];
  for (const base of ['/Library/PostgreSQL', '/usr/lib/postgresql'])
    if (existsSync(base))
      for (const v of readdirSync(base).sort().reverse()) candidates.push(join(base, v, 'bin'));
  for (const brew of ['/opt/homebrew/opt', '/usr/local/opt'])
    if (existsSync(brew))
      for (const d of readdirSync(brew).filter((n) => n.startsWith('postgresql')))
        candidates.push(join(brew, d, 'bin'));
  for (const dir of candidates) if (dir && existsSync(join(dir, 'pg_dump'))) return dir;
  return ''; // on the PATH
}

/** Connection settings as the environment variables PostgreSQL's programs read. */
function connectionEnv(url: string, database?: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: database ?? decodeURIComponent(u.pathname.slice(1)),
    ...(u.searchParams.get('sslmode')
      ? { PGSSLMODE: u.searchParams.get('sslmode') as string }
      : {}),
  };
}

const program = (name: string) => join(pgBin(), name);

export interface BackupResult {
  readonly file: string;
  readonly bytes: number;
  readonly pruned: number;
}

/** Writes `heist-<time>.dump` (custom format, compressed) and keeps the newest `keep` files. */
export function backup(options: {
  url: string;
  outDir: string;
  keep?: number;
  schema?: string;
  now?: () => Date;
}): BackupResult {
  mkdirSync(options.outDir, { recursive: true });
  const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 15);
  const file = join(options.outDir, `heist-${stamp}.dump`);
  execFileSync(
    program('pg_dump'),
    [
      '--format=custom',
      '--no-owner',
      '--file',
      file,
      ...(options.schema ? ['--schema', options.schema] : []),
    ],
    { env: connectionEnv(options.url), stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const dumps = readdirSync(options.outDir)
    .filter((f) => /^heist-\d{8}T\d{6}\.dump$/.test(f))
    .sort();
  const old = dumps.slice(0, Math.max(0, dumps.length - (options.keep ?? 14)));
  for (const f of old) unlinkSync(join(options.outDir, f));
  return { file, bytes: statSync(file).size, pruned: old.length };
}

export interface DrillResult {
  readonly tables: number;
  readonly rows: number;
  readonly mismatches: readonly string[];
  readonly scratch: string;
}

async function counts(
  url: string,
  schema: string,
  database?: string,
): Promise<Map<string, number>> {
  const u = new URL(url);
  if (database) u.pathname = `/${database}`;
  const db = PgDatabase.open({ url: u.toString(), max: 1 });
  try {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [schema],
    );
    const out = new Map<string, number>();
    for (const { table_name } of tables) {
      const r = await db.one<{ n: string }>(
        `SELECT count(*) AS n FROM ${quoteIdent(schema)}.${quoteIdent(table_name)}`,
      );
      out.set(table_name, Number(r?.n ?? 0));
    }
    return out;
  } finally {
    await db.close();
  }
}

/**
 * Restores `file` into a new scratch database next to the source, compares every table's row
 * count with the source, and drops the scratch database. Take the backup just before, on a quiet
 * database, or expect differences from writes that happened in between.
 */
export async function restoreDrill(options: {
  url: string;
  file: string;
  schema?: string;
}): Promise<DrillResult> {
  const schema = options.schema ?? 'public';
  const scratch = `heist_drill_${Date.now().toString(36)}`;
  const admin = PgDatabase.open({ url: withDatabase(options.url, 'postgres'), max: 1 });
  await admin.query(`CREATE DATABASE ${quoteIdent(scratch)}`);
  try {
    execFileSync(
      program('pg_restore'),
      ['--no-owner', '--exit-on-error', '--dbname', scratch, options.file],
      { env: connectionEnv(options.url, scratch), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const source = await counts(options.url, schema);
    const restored = await counts(options.url, schema, scratch);
    const mismatches: string[] = [];
    for (const [table, n] of source)
      if (restored.get(table) !== n)
        mismatches.push(`${table}: source ${n}, restored ${restored.get(table) ?? 'missing'}`);
    for (const table of restored.keys())
      if (!source.has(table)) mismatches.push(`${table}: only in the restored copy`);
    return {
      tables: source.size,
      rows: [...restored.values()].reduce((a, b) => a + b, 0),
      mismatches,
      scratch,
    };
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(scratch)} WITH (FORCE)`);
    await admin.close();
  }
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
