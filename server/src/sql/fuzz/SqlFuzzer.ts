import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SeededRng, type Rng } from '@heist/shared';
import type { GeneratedTables } from '../../variants/dataGenerators';
import type { JobOutcome, SandboxQuery, SandboxRunner } from '../SandboxRunner';

/** Files an escape would create; their appearing anywhere we look is a failure. */
const CANARY = 'heist_fuzz_canary';

/** What the fuzzer attacks with (Phase 18.4). */
export type FuzzFamily = 'escape' | 'write' | 'bomb' | 'oversized' | 'garbage' | 'mutation';

export interface FuzzCase {
  readonly family: FuzzFamily;
  readonly sql: string;
  readonly mode: NonNullable<SandboxQuery['mode']>;
}

/** Statements that must never succeed, in any mode. */
const ESCAPES = [
  `ATTACH DATABASE '${CANARY}.db' AS x`,
  `VACUUM INTO '${CANARY}.db'`,
  'PRAGMA writable_schema = 1',
  'PRAGMA query_only = 0',
  'PRAGMA journal_mode = WAL',
  "SELECT load_extension('/tmp/evil')",
  `SELECT readfile('/etc/passwd')`,
  `SELECT writefile('${CANARY}.txt', 'x')`,
  "SELECT fts3_tokenizer('simple')",
  "UPDATE sqlite_master SET sql = 'x'",
  "INSERT INTO sqlite_master VALUES ('table','t','t',0,'')",
  'CREATE TRIGGER t AFTER INSERT ON accounts BEGIN DELETE FROM accounts; END',
  'CREATE VIEW v AS SELECT 1',
  'CREATE TEMP TABLE t (x)',
  'DROP TABLE accounts',
  'ALTER TABLE accounts ADD COLUMN x',
  'BEGIN',
  'COMMIT',
  'SAVEPOINT s',
  'DETACH DATABASE main',
  'REINDEX',
  'ANALYZE',
  'SELECT * FROM pragma_database_list',
  'SELECT * FROM sqlite_dbpage',
];

/** Writes: refused in query mode, allowed only when a write task asks for them. */
const WRITES = [
  'DELETE FROM accounts',
  "UPDATE accounts SET owner = 'x'",
  "INSERT INTO accounts (owner, balance) VALUES ('x', 1)",
  'CREATE TABLE x (a)',
  'CREATE INDEX ix ON accounts(owner)',
  'REPLACE INTO accounts (id, owner) VALUES (1, 1)',
];

/** Resource bombs: must end by the time limit or the size limits. */
const BOMBS = [
  'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT COUNT(*) FROM r',
  'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT * FROM r',
  "WITH RECURSIVE r(s) AS (SELECT 'x' UNION ALL SELECT s || s FROM r) SELECT length(s) FROM r",
  'SELECT randomblob(1000000000)',
  'SELECT zeroblob(2000000000)',
  "SELECT printf('%.*c', 2000000000, 'x')",
  "SELECT replace(hex(zeroblob(500000)), '0', 'aaaaaaaaaa')",
  'SELECT * FROM accounts a, accounts b, accounts c, accounts d, accounts e, accounts f, accounts g, accounts h',
  "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r LIMIT 10000000) SELECT group_concat(n, ',') FROM r",
  "SELECT 'a' LIKE '" + '%a'.repeat(60) + "%b'",
  'SELECT ' + '('.repeat(5000) + '1' + ')'.repeat(5000),
  'SELECT ' + Array.from({ length: 3000 }, (_, i) => `${i}`).join(' + '),
];

const GARBAGE_PIECES = [
  "'",
  '"',
  ';',
  '--',
  '/*',
  '*/',
  '\u0000',
  '￿',
  '😈',
  'SELECT',
  'FROM',
  'accounts',
  '(',
  ')',
  ',',
  '*',
  "x'00'",
  '?',
  ':a',
  '$b',
  '@c',
  'UNION',
  'WHERE',
  '1=1',
  'NULL',
  '\\',
  '\n',
];

const BENIGN = [
  'SELECT * FROM accounts',
  'SELECT owner, balance FROM accounts WHERE balance > 10',
  'SELECT COUNT(*) FROM accounts',
];

/** Builds hostile queries from a seed; the same seed gives the same cases. */
export function* fuzzCases(seed: string, count: number): Generator<FuzzCase> {
  const rng = new SeededRng(seed);
  for (let i = 0; i < count; i++) yield nextCase(rng);
}

function nextCase(rng: Rng): FuzzCase {
  const mode = rng.pick(['query', 'query', 'plan', 'write'] as const);
  const family = rng.pick(['escape', 'write', 'bomb', 'oversized', 'garbage', 'mutation'] as const);
  switch (family) {
    case 'escape':
      return { family, mode, sql: disguise(rng, rng.pick(ESCAPES)) };
    case 'write':
      return { family, mode, sql: disguise(rng, rng.pick(WRITES)) };
    case 'bomb':
      return { family, mode: mode === 'write' ? 'query' : mode, sql: rng.pick(BOMBS) };
    case 'oversized':
      return {
        family,
        mode,
        sql: rng.bool()
          ? `SELECT '${'x'.repeat(rng.int(20_000, 200_000))}'`
          : Array.from({ length: rng.int(20, 400) }, () => rng.pick(BENIGN)).join('; '),
      };
    case 'garbage':
      return {
        family,
        mode,
        sql: Array.from({ length: rng.int(1, 40) }, () => rng.pick(GARBAGE_PIECES)).join(
          rng.pick(['', ' ']),
        ),
      };
    case 'mutation':
      // A benign query with a hostile statement smuggled behind it.
      return {
        family,
        mode,
        sql: `${rng.pick(BENIGN)}${rng.pick([';', '; --\n', ';/**/', ' UNION ALL '])}${rng.pick([...ESCAPES, ...WRITES])}`,
      };
  }
}

/** Case, comment and whitespace tricks a keyword check might miss. */
function disguise(rng: Rng, sql: string): string {
  let out = sql;
  if (rng.bool(0.3))
    out = [...out].map((c) => (rng.bool() ? c.toUpperCase() : c.toLowerCase())).join('');
  if (rng.bool(0.3)) out = out.replace(/ /g, () => rng.pick([' ', '/**/', '\t', '\n  ']));
  if (rng.bool(0.2)) out = `/* hello */ ${out}`;
  if (rng.bool(0.2)) out = `WITH c AS (SELECT 1) ${out}`;
  return out;
}

export interface FuzzFailure {
  readonly case: FuzzCase;
  readonly reason: string;
}

export interface FuzzReport {
  readonly cases: number;
  readonly byFamily: Partial<Record<FuzzFamily, number>>;
  readonly timeouts: number;
  readonly failures: readonly FuzzFailure[];
}

const data = {
  schemaSql: 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, owner TEXT, balance REAL);',
  tables: new Map([
    [
      'accounts',
      {
        columns: ['id', 'owner', 'balance'],
        rows: [
          [1, 'Ana', 100.5],
          [2, 'Ben', 20],
          [3, 'Cy', null],
        ],
      },
    ],
  ]) as GeneratedTables,
};

/**
 * Runs the cases through a real sandbox runner and checks the rules no input may break:
 * - nothing escapes (no escape statement succeeds; no canary file appears);
 * - writes succeed only in write mode, and the data is intact on the next look;
 * - every job ends (by the time limit at worst) and results stay within the row cap;
 * - the runner keeps working afterwards.
 */
export async function fuzzSandbox(
  runner: SandboxRunner,
  cases: Iterable<FuzzCase>,
  options: {
    readonly dirs?: readonly string[];
    readonly maxRows?: number;
    readonly slackMs?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<FuzzReport> {
  const failures: FuzzFailure[] = [];
  const byFamily: Partial<Record<FuzzFamily, number>> = {};
  let timeouts = 0;
  let n = 0;
  const dirs = options.dirs ?? [process.cwd()];
  const maxRows = options.maxRows ?? 1000;
  const limitMs = (options.timeoutMs ?? 2000) + (options.slackMs ?? 3000);
  for (const c of cases) {
    n++;
    byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
    const started = Date.now();
    let outcome: JobOutcome;
    try {
      outcome = await runner.run({
        data,
        queries: [
          { sql: c.sql, mode: c.mode },
          { sql: 'SELECT id, owner, balance FROM accounts ORDER BY id' },
        ],
      });
    } catch (err) {
      failures.push({ case: c, reason: `runner threw: ${String(err)}` });
      continue;
    }
    if (Date.now() - started > limitMs)
      failures.push({ case: c, reason: 'took longer than the time limit' });
    if (!outcome.ok) {
      if (outcome.code === 'timeout') timeouts++;
      else failures.push({ case: c, reason: `job failed: ${outcome.code} ${outcome.message}` });
      continue;
    }
    const [first, check] = outcome.outcomes;
    if (
      first?.ok &&
      (c.family === 'escape' || (c.family === 'mutation' && ESCAPES.some((e) => c.sql.endsWith(e))))
    )
      failures.push({ case: c, reason: 'an escape statement succeeded' });
    if (first?.ok && c.family === 'write' && c.mode !== 'write')
      failures.push({ case: c, reason: 'a write succeeded outside a write task' });
    if (first?.ok && first.result.rows.length > maxRows)
      failures.push({
        case: c,
        reason: `returned ${first.result.rows.length} rows (cap ${maxRows})`,
      });
    if (c.mode !== 'write' && (!check?.ok || check.result.rows.length !== 3))
      failures.push({ case: c, reason: 'the data changed or became unreadable' });
  }
  for (const dir of dirs)
    for (const ext of ['db', 'txt'])
      if (existsSync(join(dir, `${CANARY}.${ext}`)))
        failures.push({
          case: { family: 'escape', mode: 'query', sql: '(file check)' },
          reason: `a file was written: ${join(dir, `${CANARY}.${ext}`)}`,
        });
  const alive = await runner.run({ data, queries: [{ sql: 'SELECT 1' }] });
  if (!alive.ok)
    failures.push({
      case: { family: 'garbage', mode: 'query', sql: 'SELECT 1' },
      reason: 'the runner stopped working',
    });
  return { cases: n, byFamily, timeouts, failures };
}
