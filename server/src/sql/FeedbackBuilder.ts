import type { Mismatch } from './ResultComparator';
import type { SandboxErrorCode } from './SqlSandbox';

export type FeedbackCode = Mismatch['kind'] | SandboxErrorCode;

export interface Feedback {
  readonly code: FeedbackCode;
  readonly message: string;
}

/**
 * Turns grading outcomes into hints for the student. Rule: describe the
 * *shape* of the difference (counts, which column, order) but never expected
 * values or the reference query.
 */
export class FeedbackBuilder {
  fromMismatch(mismatch: Mismatch, actualColumns: readonly string[]): Feedback {
    switch (mismatch.kind) {
      case 'truncated':
        return {
          code: mismatch.kind,
          message:
            'Your query returned far too many rows. Check your WHERE clause and JOIN conditions.',
        };
      case 'column_count':
        return {
          code: mismatch.kind,
          message: `Your query returns ${plural(mismatch.actual, 'column')}; the answer has ${mismatch.expected}.`,
        };
      case 'column_names':
        return {
          code: mismatch.kind,
          message: `Name your columns exactly: ${mismatch.expected.join(', ')}.`,
        };
      case 'row_count':
        return {
          code: mismatch.kind,
          message: `Your query returns ${plural(mismatch.actual, 'row')}; the answer has ${mismatch.expected}.`,
        };
      case 'values': {
        const where =
          mismatch.column === null
            ? 'Some rows have the wrong combination of values.'
            : `Values in column ${mismatch.column + 1} (${actualColumns[mismatch.column] ?? '?'}) don't match.`;
        return { code: mismatch.kind, message: `Right shape, wrong data. ${where}` };
      }
      case 'order':
        return { code: mismatch.kind, message: 'Right rows, wrong order. Check your ORDER BY.' };
    }
  }

  fromSandboxError(code: SandboxErrorCode, message: string): Feedback {
    // Sandbox messages describe the student's own query, so they are safe to show.
    return { code, message };
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
