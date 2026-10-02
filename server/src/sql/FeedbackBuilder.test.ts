import { describe, expect, it } from 'vitest';
import { FeedbackBuilder } from './FeedbackBuilder';
import type { Mismatch } from './ResultComparator';

const fb = new FeedbackBuilder();

describe('FeedbackBuilder', () => {
  it.each<[Mismatch, RegExp]>([
    [{ kind: 'truncated' }, /too many rows/],
    [{ kind: 'column_count', expected: 2, actual: 1 }, /returns 1 column; the answer has 2/],
    [{ kind: 'column_names', expected: ['name', 'total'], actual: ['a', 'b'] }, /name, total/],
    [{ kind: 'row_count', expected: 3, actual: 5 }, /returns 5 rows; the answer has 3/],
    [{ kind: 'values', column: 1 }, /column 2 \(balance\)/],
    [{ kind: 'values', column: null }, /wrong combination/],
    [{ kind: 'order' }, /ORDER BY/],
  ])('explains %j', (mismatch, pattern) => {
    const feedback = fb.fromMismatch(mismatch, ['owner', 'balance']);
    expect(feedback.code).toBe(mismatch.kind);
    expect(feedback.message).toMatch(pattern);
  });
});
