import { describe, expect, it } from 'vitest';
import { checkSingleQuery } from './statement';

describe('checkSingleQuery', () => {
  it.each([
    'SELECT 1',
    'select * from t;',
    '  -- comment\nSELECT 1; -- trailing comment',
    '/* lead */ WITH x AS (SELECT 1) SELECT * FROM x;;',
    "SELECT ';' AS semi, 'it''s' AS q",
    'SELECT "a;b" FROM [weird;name]',
  ])('accepts %j', (sql) => {
    expect(checkSingleQuery(sql).ok).toBe(true);
  });

  it('strips the trailing semicolon', () => {
    expect(checkSingleQuery('SELECT 1 ;  ')).toEqual({ ok: true, sql: 'SELECT 1' });
  });

  it.each([
    ['', 'empty'],
    ['-- only a comment', 'empty'],
    ['SELECT 1; DROP TABLE t', 'multiple_statements'],
    ['SELECT 1; SELECT 2', 'multiple_statements'],
    ['DROP TABLE t', 'not_a_query'],
    ["ATTACH 'x.db' AS y", 'not_a_query'],
    ['PRAGMA query_only = 0', 'not_a_query'],
    ['INSERT INTO t VALUES (1)', 'not_a_query'],
    ["SELECT 'unclosed", 'unterminated'],
    ['SELECT 1 /* unclosed', 'unterminated'],
  ])('rejects %j as %s', (sql, reason) => {
    expect(checkSingleQuery(sql)).toEqual({ ok: false, reason });
  });
});
