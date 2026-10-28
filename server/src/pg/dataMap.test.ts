import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from './testing';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const KINDS = new Set(['personal', 'pseudonymous', 'record', 'school', 'content', 'technical']);

/** `table → column → kind`, read from docs/privacy.md: "### `table`" then rows "| `column` | … | kind | … |". */
function dataMap(): Map<string, Map<string, string>> {
  const text = readFileSync(new URL('../../../docs/privacy.md', import.meta.url), 'utf8');
  const map = new Map<string, Map<string, string>>();
  let table: Map<string, string> | undefined;
  for (const line of text.split('\n')) {
    const heading = /^### `(\w+)`/.exec(line);
    if (heading) {
      table = new Map();
      map.set(heading[1] as string, table);
      continue;
    }
    if (line.startsWith('## ')) table = undefined;
    const row = /^\| `(\w+)` \|(.*)\|\s*$/.exec(line);
    if (row && table) {
      const cells = line.split('|').map((c) => c.trim());
      // | `col` | what | kind | kept |
      table.set(row[1] as string, cells[3] ?? '');
    }
  }
  return map;
}

describe.skipIf(!TEST_DATABASE_URL)('the data map (21.1)', () => {
  it('describes every table and column the database has, and nothing it does not', async () => {
    const { db, drop } = await freshPg();
    drops.push(drop);
    const rows = await db.query<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns
       WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
      [db.schema],
    );
    const actual = new Map<string, string[]>();
    for (const { t, c } of rows) actual.set(t, [...(actual.get(t) ?? []), c]);
    const documented = dataMap();

    const undocumentedTables = [...actual.keys()].filter((t) => !documented.has(t));
    const missingColumns = [...actual].flatMap(([t, cols]) =>
      cols.filter((c) => !documented.get(t)?.has(c)).map((c) => `${t}.${c}`),
    );
    const inventedColumns = [...documented].flatMap(([t, cols]) =>
      [...cols.keys()].filter((c) => !actual.get(t)?.includes(c)).map((c) => `${t}.${c}`),
    );
    const staleTables = [...documented.keys()].filter((t) => !actual.has(t));
    expect({ undocumentedTables, missingColumns, inventedColumns, staleTables }).toEqual({
      undocumentedTables: [],
      missingColumns: [],
      inventedColumns: [],
      staleTables: [],
    });
  });

  it('gives every column a known kind, and names where personal data lives', () => {
    const documented = dataMap();
    const kinds = new Map<string, string[]>();
    for (const [t, cols] of documented)
      for (const [c, k] of cols) {
        expect(KINDS.has(k), `${t}.${c} has kind "${k}"`).toBe(true);
        kinds.set(k, [...(kinds.get(k) ?? []), `${t}.${c}`]);
      }
    // The personal columns are a short, known list: a new one is a decision, not an accident.
    expect(kinds.get('personal')?.sort()).toEqual(
      [
        'audit_log.actor',
        'brief_submissions.marked_by',
        'class_rounds.awards',
        'class_rounds.replay',
        'class_results.name',
        'concept_card_versions.created_by',
        'concept_cards.updated_by',
        'players.display_name',
        'players.email',
        'players.google_sub',
        'players.school_domain',
        'pools.created_by',
        'question_versions.created_by',
        'questions.updated_by',
        'users.email',
        'users.password_hash',
      ].sort(),
    );
  });
});
