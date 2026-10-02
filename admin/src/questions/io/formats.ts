import type { QuestionTemplate } from '@heist/shared';
import { parseCsv, toCsv } from './csv';

export const EXPORT_FORMAT = 'heist-questions';
export const EXPORT_VERSION = 1;

/** One raw, not-yet-validated question from an import file. */
export interface RawQuestion {
  /** 1-based position in the file, for error messages. */
  readonly index: number;
  readonly data: unknown;
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

// Pattern: Strategy — Why: JSON and CSV differ only in how a file becomes
// raw question objects (and back). Import/export logic is shared; a new
// format (e.g. YAML) is one more class.
export interface QuestionFormat {
  readonly name: 'json' | 'csv';
  readonly contentType: string;
  parse(body: unknown): RawQuestion[];
  serialize(questions: readonly QuestionTemplate[]): string;
}

export class JsonQuestionFormat implements QuestionFormat {
  readonly name = 'json';
  readonly contentType = 'application/json';

  parse(body: unknown): RawQuestion[] {
    const list = Array.isArray(body)
      ? body
      : typeof body === 'object' &&
          body !== null &&
          Array.isArray((body as { questions?: unknown }).questions)
        ? (body as { questions: unknown[] }).questions
        : undefined;
    if (!list)
      throw new ImportFormatError('Expected an array of questions or { "questions": [...] }');
    return list.map((data, i) => ({ index: i + 1, data }));
  }

  serialize(questions: readonly QuestionTemplate[]): string {
    return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, questions }, null, 2);
  }
}

/**
 * Spreadsheet-friendly: one row per question. Nested parts (data_gen, params,
 * hints, compare) are JSON inside their cell, so CSV round-trips losslessly.
 */
const CSV_COLUMNS = [
  'slug',
  'title',
  'tier',
  'topic',
  'enabled',
  'story_md',
  'schema_sql',
  'reference_sql',
  'order_matters',
  'allow_empty',
  'compare',
  'data_gen',
  'params',
  'hints',
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];
const JSON_COLUMNS = new Set<CsvColumn>(['compare', 'data_gen', 'params', 'hints']);
const BOOL_COLUMNS = new Set<CsvColumn>(['enabled', 'order_matters', 'allow_empty']);

export class CsvQuestionFormat implements QuestionFormat {
  readonly name = 'csv';
  readonly contentType = 'text/csv; charset=utf-8';

  parse(body: unknown): RawQuestion[] {
    if (typeof body !== 'string') throw new ImportFormatError('Expected CSV text');
    const [header, ...rows] = parseCsv(body);
    if (!header) throw new ImportFormatError('Empty CSV');
    const missing = ['slug', 'title', 'tier'].filter((c) => !header.includes(c));
    if (missing.length)
      throw new ImportFormatError(`CSV is missing columns: ${missing.join(', ')}`);

    return rows.map((cells, i) => {
      const data: Record<string, unknown> = {};
      header.forEach((column, c) => {
        const cell = cells[c] ?? '';
        if (cell === '') return; // empty → let schema defaults apply
        data[column] = this.decode(column as CsvColumn, cell);
      });
      return { index: i + 1, data };
    });
  }

  serialize(questions: readonly QuestionTemplate[]): string {
    const rows = questions.map((q) =>
      CSV_COLUMNS.map((column) => {
        const value = q[column];
        if (column === 'topic') return (value as string[]).join(';');
        if (JSON_COLUMNS.has(column)) return JSON.stringify(value);
        return String(value);
      }),
    );
    return toCsv([[...CSV_COLUMNS], ...rows]);
  }

  private decode(column: CsvColumn, cell: string): unknown {
    if (column === 'tier') return Number(cell);
    if (column === 'topic')
      return cell
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean);
    if (BOOL_COLUMNS.has(column)) return ['true', '1', 'yes'].includes(cell.trim().toLowerCase());
    if (JSON_COLUMNS.has(column)) {
      try {
        return JSON.parse(cell);
      } catch {
        return cell; // the schema reports it as the wrong type, with the column name
      }
    }
    return cell;
  }
}

export const questionFormats: Record<'json' | 'csv', QuestionFormat> = {
  json: new JsonQuestionFormat(),
  csv: new CsvQuestionFormat(),
};
