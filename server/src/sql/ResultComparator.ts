import type { SqlValue } from '../variants/dataGenerators';
import type { QueryResult } from './SqlSandbox';

export interface ComparePolicy {
  /** Row order must match (question asks for ORDER BY). */
  readonly orderMatters: boolean;
  /** Column names/aliases must match (default: only position matters). */
  readonly compareNames: boolean;
  /** Text comparison is case-sensitive. */
  readonly caseSensitive: boolean;
}

/** Why a result didn't match — feeds non-leaky hints (FeedbackBuilder). */
export type Mismatch =
  | { readonly kind: 'truncated' }
  | { readonly kind: 'column_count'; readonly expected: number; readonly actual: number }
  | {
      readonly kind: 'column_names';
      readonly expected: readonly string[];
      readonly actual: readonly string[];
    }
  | { readonly kind: 'row_count'; readonly expected: number; readonly actual: number }
  /** Same rows but a column's values differ; `column` is the expected column's position. */
  | { readonly kind: 'values'; readonly column: number | null }
  /** Right rows, wrong order. */
  | { readonly kind: 'order' };

export type Comparison =
  { readonly match: true } | { readonly match: false; readonly mismatch: Mismatch };

/** Floats within this absolute difference are equal (e.g. AVG rounding). */
const FLOAT_DECIMALS = 6;

type Row = readonly SqlValue[];

// Pattern: Strategy — Why: "rows must match in order" and "rows must match as
// a multiset" are interchangeable rules chosen per question; the comparator
// stays the same and new rules (e.g. "first N only") plug in as new classes.
interface RowMatchStrategy {
  matches(expected: readonly string[], actual: readonly string[]): boolean;
}

class OrderedRows implements RowMatchStrategy {
  matches(expected: readonly string[], actual: readonly string[]): boolean {
    return expected.every((row, i) => row === actual[i]);
  }
}

class UnorderedRows implements RowMatchStrategy {
  matches(expected: readonly string[], actual: readonly string[]): boolean {
    return sameMultiset(expected, actual);
  }
}

export class ResultComparator {
  private readonly rows: RowMatchStrategy;

  constructor(private readonly policy: ComparePolicy) {
    this.rows = policy.orderMatters ? new OrderedRows() : new UnorderedRows();
  }

  compare(expected: QueryResult, actual: QueryResult): Comparison {
    if (actual.truncated) return fail({ kind: 'truncated' });
    if (expected.columns.length !== actual.columns.length) {
      return fail({
        kind: 'column_count',
        expected: expected.columns.length,
        actual: actual.columns.length,
      });
    }
    if (this.policy.compareNames) {
      const norm = (names: readonly string[]) => names.map((n) => n.toLowerCase());
      if (norm(expected.columns).join('\0') !== norm(actual.columns).join('\0')) {
        return fail({ kind: 'column_names', expected: expected.columns, actual: actual.columns });
      }
    }
    if (expected.rows.length !== actual.rows.length) {
      return fail({
        kind: 'row_count',
        expected: expected.rows.length,
        actual: actual.rows.length,
      });
    }

    const expectedKeys = expected.rows.map((r) => this.rowKey(r));
    const actualKeys = actual.rows.map((r) => this.rowKey(r));
    if (this.rows.matches(expectedKeys, actualKeys)) return { match: true };
    if (this.policy.orderMatters && sameMultiset(expectedKeys, actualKeys))
      return fail({ kind: 'order' });
    return fail({ kind: 'values', column: this.firstDifferingColumn(expected.rows, actual.rows) });
  }

  /** First column whose multiset of values differs — tells the student where to look. */
  private firstDifferingColumn(expected: readonly Row[], actual: readonly Row[]): number | null {
    const width = expected[0]?.length ?? 0;
    for (let c = 0; c < width; c++) {
      const col = (rows: readonly Row[]) => rows.map((r) => this.valueKey(r[c] ?? null));
      if (!sameMultiset(col(expected), col(actual))) return c;
    }
    return null;
  }

  private rowKey(row: Row): string {
    return row.map((v) => this.valueKey(v)).join('\u0001');
  }

  private valueKey(value: SqlValue): string {
    if (value === null) return 'n:';
    if (typeof value === 'number') {
      // 3, 3.0 and 3.0000000001 compare equal; -0 equals 0.
      return `d:${Number(value.toFixed(FLOAT_DECIMALS)) + 0}`;
    }
    return `s:${this.policy.caseSensitive ? value : value.toLowerCase()}`;
  }
}

function fail(mismatch: Mismatch): Comparison {
  return { match: false, mismatch };
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const k of a) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const k of b) {
    const n = counts.get(k);
    if (!n) return false;
    counts.set(k, n - 1);
  }
  return true;
}
