import { afterEach, describe, expect, it } from 'vitest';
import type { GeneratedTables } from '../variants/dataGenerators';
import { SandboxError, SqlSandbox } from './SqlSandbox';

const data = {
  schemaSql: `
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, owner TEXT, balance REAL);
    CREATE TABLE empty_table (x INTEGER);`,
  tables: new Map([
    [
      'accounts',
      {
        columns: ['id', 'owner', 'balance'],
        rows: [
          [1, 'Ana', 100.5],
          [2, "O'Neil", 20],
          [3, 'Ben', null],
        ],
      },
    ],
  ]) as GeneratedTables,
};

let sandbox: SqlSandbox | undefined;
const make = () => (sandbox = SqlSandbox.create(data));
afterEach(() => sandbox?.close());

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof SandboxError) return err.code;
    throw err;
  }
  return 'no error';
}

describe('SqlSandbox: running queries', () => {
  it('returns columns and rows', () => {
    const r = make().query('SELECT id, owner FROM accounts ORDER BY id');
    expect(r).toEqual({
      columns: ['id', 'owner'],
      rows: [
        [1, 'Ana'],
        [2, "O'Neil"],
        [3, 'Ben'],
      ],
      truncated: false,
    });
  });

  it('keeps duplicate column names (arrays, not objects)', () => {
    expect(make().query('SELECT 1 AS a, 2 AS a').rows).toEqual([[1, 2]]);
  });

  it('supports CTEs, recursive CTEs and window functions', () => {
    const s = make();
    expect(
      s.query(
        'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3) SELECT i FROM n',
      ).rows,
    ).toEqual([[1], [2], [3]]);
    expect(
      s.query('SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) FROM accounts ORDER BY id').rows,
    ).toEqual([
      [1, 3],
      [2, 2],
      [3, 1],
    ]);
  });

  it('truncates at maxRows and says so', () => {
    const r = make().query(
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50) SELECT i FROM n',
      10,
    );
    expect(r.rows).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('reports SQL errors as sql_error', () => {
    expect(errorCode(() => make().query('SELECT nope FROM accounts'))).toBe('sql_error');
  });
});

describe('SqlSandbox: security', () => {
  it.each([
    ['DROP TABLE accounts', 'not_a_query'],
    ['DELETE FROM accounts', 'not_a_query'],
    ["ATTACH '/tmp/evil.db' AS evil", 'not_a_query'],
    ['PRAGMA writable_schema = 1', 'not_a_query'],
    ['SELECT 1; DROP TABLE accounts', 'multiple_statements'],
    ["SELECT * FROM pragma_table_info('accounts')", 'not_allowed'],
    ["SELECT load_extension('/tmp/evil.so')", 'not_allowed'],
    ['SELECT length(randomblob(100000000))', 'sql_error'],
  ])('blocks %j (%s)', (sql, code) => {
    expect(errorCode(() => make().query(sql))).toBe(code);
  });

  it('caps generated strings instead of allocating them', () => {
    // Over-limit printf yields NULL rather than a 100 MB string.
    expect(make().query("SELECT length(printf('%.*c', 100000000, 'x'))").rows).toEqual([[null]]);
  });

  it('cannot write even via a CTE-wrapped statement', () => {
    expect(errorCode(() => make().query('WITH x AS (SELECT 1) DELETE FROM accounts'))).toBe(
      'not_allowed',
    );
    expect(make().query('SELECT COUNT(*) FROM accounts').rows).toEqual([[3]]);
  });

  it('leaves the data unchanged after hostile attempts', () => {
    const s = make();
    for (const sql of [
      'DELETE FROM accounts',
      'UPDATE accounts SET balance = 0',
      'DROP TABLE accounts',
    ]) {
      expect(() => s.query(sql)).toThrow(SandboxError);
    }
    expect(s.query('SELECT COUNT(*), SUM(balance) FROM accounts').rows).toEqual([[3, 120.5]]);
  });
});
