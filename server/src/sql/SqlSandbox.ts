import { DatabaseSync, constants } from 'node:sqlite';
import type { GeneratedTables, SqlValue } from '../variants/dataGenerators';
import { checkSingleQuery } from './statement';

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqlValue[])[];
  /** True when the query returned more than maxRows rows (extra rows dropped). */
  readonly truncated: boolean;
}

export type SandboxErrorCode =
  'empty' | 'multiple_statements' | 'not_a_query' | 'unterminated' | 'not_allowed' | 'sql_error';

export class SandboxError extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

export interface SandboxData {
  readonly schemaSql: string;
  readonly tables: GeneratedTables;
}

export const DEFAULT_MAX_ROWS = 1000;

const PRECHECK_MESSAGES = {
  empty: 'Write a query first.',
  multiple_statements: 'Only one statement is allowed.',
  not_a_query: 'Only SELECT (or WITH … SELECT) queries are allowed.',
  unterminated: 'Unterminated string, identifier or comment.',
} as const;

/** Functions that can touch the filesystem or SQLite internals. */
const DENIED_FUNCTIONS = new Set(['load_extension', 'fts3_tokenizer', 'readfile', 'writefile']);

// Pattern: Adapter — Why: wraps node:sqlite behind a tiny "load data, run
// one read-only query" API. Grading code never sees SQLite handles, flags or
// authorizer codes, and the engine could be swapped without touching it.
export class SqlSandbox {
  private constructor(private readonly db: DatabaseSync) {}

  /** Builds a fresh in-memory database for one challenge. */
  static create(data: SandboxData): SqlSandbox {
    const db = new DatabaseSync(':memory:', {
      defensive: true,
      allowExtension: false,
      limits: {
        attach: 0,
        length: 1_000_000, // max string/blob bytes — stops randomblob/zeroblob/printf memory bombs
        sqlLength: 20_000,
        compoundSelect: 50,
        exprDepth: 200,
      },
    });
    db.exec(data.schemaSql);
    loadTables(db, data.tables);
    db.exec('PRAGMA query_only = 1');
    db.setAuthorizer(authorize);
    return new SqlSandbox(db);
  }

  /** Runs one untrusted read-only query. Throws SandboxError on anything else. */
  query(sql: string, maxRows = DEFAULT_MAX_ROWS): QueryResult {
    const check = checkSingleQuery(sql);
    if (!check.ok) throw new SandboxError(check.reason, PRECHECK_MESSAGES[check.reason]);

    let statement;
    try {
      statement = this.db.prepare(check.sql);
    } catch (err) {
      throw toSandboxError(err);
    }
    statement.setReturnArrays(true);
    const columns = statement.columns().map((c) => c.name);
    const rows: SqlValue[][] = [];
    let truncated = false;
    try {
      for (const row of statement.iterate() as Iterable<unknown[]>) {
        if (rows.length === maxRows) {
          truncated = true;
          break;
        }
        rows.push(row.map(toSqlValue));
      }
    } catch (err) {
      throw toSandboxError(err);
    }
    return { columns, rows, truncated };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

function loadTables(db: DatabaseSync, tables: GeneratedTables): void {
  db.exec('BEGIN');
  for (const [table, { columns, rows }] of tables) {
    if (columns.length === 0) continue;
    const insert = db.prepare(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    );
    for (const row of rows) insert.run(...row);
  }
  db.exec('COMMIT');
}

/**
 * SQLite authorizer: allow-list of what a student query may do. Everything
 * not listed (writes, DDL, PRAGMA incl. pragma_* table functions, ATTACH,
 * transactions) is denied before the statement is even compiled.
 */
function authorize(action: number, arg1: string | null, arg2: string | null): number {
  switch (action) {
    case constants.SQLITE_SELECT:
    case constants.SQLITE_RECURSIVE:
      return constants.SQLITE_OK;
    case constants.SQLITE_READ:
      return arg1?.startsWith('pragma_') ? constants.SQLITE_DENY : constants.SQLITE_OK;
    case constants.SQLITE_FUNCTION:
      return arg2 && DENIED_FUNCTIONS.has(arg2.toLowerCase())
        ? constants.SQLITE_DENY
        : constants.SQLITE_OK;
    default:
      return constants.SQLITE_DENY;
  }
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return `x'${Buffer.from(value).toString('hex')}'`;
  return String(value);
}

function toSandboxError(err: unknown): SandboxError {
  const message = err instanceof Error ? err.message : String(err);
  if (/not authorized|is prohibited/i.test(message)) {
    return new SandboxError('not_allowed', 'That operation is not allowed here.');
  }
  return new SandboxError('sql_error', message);
}
