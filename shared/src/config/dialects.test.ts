import { describe, expect, it } from 'vitest';
import { questionQuirks, questionTemplateSchema } from '../questions/template';
import { sampleQuestion } from '../questions/fixtures';
import {
  DEFAULT_DIALECT_SETTINGS,
  DIALECT_QUIRKS,
  detectQuirks,
  dialectSettingsSchema,
} from './dialects';

describe('dialect packs (17.14)', () => {
  it('ship valid PostgreSQL and MySQL packs covering every quirk', () => {
    expect(dialectSettingsSchema.safeParse(DEFAULT_DIALECT_SETTINGS).success).toBe(true);
    for (const id of ['postgres', 'mysql'])
      expect(Object.keys(DEFAULT_DIALECT_SETTINGS.packs[id]?.entries ?? {}).sort()).toEqual(
        [...DIALECT_QUIRKS].sort(),
      );
  });

  it('finds quirks in SQL', () => {
    expect(detectQuirks("SELECT a || b FROM t WHERE name LIKE 'A%' LIMIT 3")).toEqual([
      'string-concat',
      'limit-offset',
      'like-case',
    ]);
    expect(detectQuirks("SELECT strftime('%Y', at), SUM(x) / COUNT(*) FROM t")).toEqual([
      'integer-division',
      'dates',
    ]);
    expect(detectQuirks('SELECT name FROM staff')).toEqual([]);
  });

  it("joins a question's own flags with what its SQL shows", () => {
    const q = questionTemplateSchema.parse({
      ...sampleQuestion,
      quirks: ['bare-columns'],
      reference_sql: "SELECT name FROM employees WHERE name LIKE 'A%'",
    });
    expect(questionQuirks(q)).toEqual(['like-case', 'bare-columns']);
  });
});
