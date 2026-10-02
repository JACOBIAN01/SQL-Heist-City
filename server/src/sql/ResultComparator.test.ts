import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../variants/dataGenerators';
import { ResultComparator, type ComparePolicy } from './ResultComparator';
import type { QueryResult } from './SqlSandbox';

const result = (columns: string[], rows: SqlValue[][], truncated = false): QueryResult => ({
  columns,
  rows,
  truncated,
});
const policy = (p: Partial<ComparePolicy> = {}): ComparePolicy => ({
  orderMatters: false,
  compareNames: false,
  caseSensitive: true,
  ...p,
});
const cmp = (p: Partial<ComparePolicy>, expected: QueryResult, actual: QueryResult) =>
  new ResultComparator(policy(p)).compare(expected, actual);

const expected = result(
  ['name', 'total'],
  [
    ['Ana', 10],
    ['Ben', 2.5],
    ['Cy', null],
  ],
);

describe('ResultComparator', () => {
  it('matches identical results', () => {
    expect(cmp({}, expected, expected)).toEqual({ match: true });
  });

  it('ignores row order unless order matters', () => {
    const shuffled = result(
      ['name', 'total'],
      [
        ['Cy', null],
        ['Ana', 10],
        ['Ben', 2.5],
      ],
    );
    expect(cmp({}, expected, shuffled).match).toBe(true);
    expect(cmp({ orderMatters: true }, expected, shuffled)).toEqual({
      match: false,
      mismatch: { kind: 'order' },
    });
  });

  it('ignores aliases by default but can require them', () => {
    const aliased = result(['n', 'SUM(x)'], expected.rows as SqlValue[][]);
    expect(cmp({}, expected, aliased).match).toBe(true);
    expect(cmp({ compareNames: true }, expected, aliased)).toMatchObject({
      mismatch: { kind: 'column_names' },
    });
    const upper = result(['NAME', 'Total'], expected.rows as SqlValue[][]);
    expect(cmp({ compareNames: true }, expected, upper).match).toBe(true);
  });

  it('treats close floats and int/float forms as equal', () => {
    const e = result(['avg'], [[3], [0.1 + 0.2]]);
    const a = result(['avg'], [[3.0000000001], [0.3]]);
    expect(cmp({}, e, a).match).toBe(true);
    expect(cmp({}, result(['x'], [[1.5]]), result(['x'], [[1.51]])).match).toBe(false);
  });

  it('distinguishes NULL, empty string and 0', () => {
    expect(cmp({}, result(['x'], [[null]]), result(['x'], [['']])).match).toBe(false);
    expect(cmp({}, result(['x'], [[null]]), result(['x'], [[0]])).match).toBe(false);
  });

  it('respects case sensitivity', () => {
    const e = result(['x'], [['Vault']]);
    const a = result(['x'], [['VAULT']]);
    expect(cmp({}, e, a).match).toBe(false);
    expect(cmp({ caseSensitive: false }, e, a).match).toBe(true);
  });

  it('respects duplicates (multiset, not set)', () => {
    const e = result(['x'], [[1], [1], [2]]);
    const a = result(['x'], [[1], [2], [2]]);
    expect(cmp({}, e, a)).toEqual({ match: false, mismatch: { kind: 'values', column: 0 } });
  });

  it.each([
    [
      'column count',
      result(['name'], [['Ana'], ['Ben'], ['Cy']]),
      { kind: 'column_count', expected: 2, actual: 1 },
    ],
    [
      'row count',
      result(['name', 'total'], [['Ana', 10]]),
      { kind: 'row_count', expected: 3, actual: 1 },
    ],
    [
      'differing column',
      result(
        ['name', 'total'],
        [
          ['Ana', 10],
          ['Ben', 2.5],
          ['Cy', 0],
        ],
      ),
      { kind: 'values', column: 1 },
    ],
    ['truncated', result(['name', 'total'], [], true), { kind: 'truncated' }],
  ])('explains a %s mismatch', (_label, actual, mismatch) => {
    expect(cmp({}, expected, actual)).toEqual({ match: false, mismatch });
  });

  it('matches two empty results', () => {
    expect(cmp({}, result(['x'], []), result(['y'], [])).match).toBe(true);
  });
});
