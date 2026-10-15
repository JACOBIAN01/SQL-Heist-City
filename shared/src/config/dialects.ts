import { z } from 'zod';

/**
 * SQL that behaves differently outside SQLite (the game's engine). A question is flagged with the
 * quirks it touches (by hand, and found in its SQL); a class's dialect pack says what each one
 * looks like in the dialect the students will use (Phase 17.14).
 */
export const DIALECT_QUIRKS = [
  'integer-division',
  'string-concat',
  'limit-offset',
  'dates',
  'like-case',
  'bare-columns',
  'nulls-order',
  'upsert',
  'types',
  'autoincrement',
  'boolean',
  'quoting',
] as const;
export type DialectQuirk = (typeof DIALECT_QUIRKS)[number];

const text = z.string().trim().min(1).max(400);

export const dialectEntrySchema = z.object({
  /** What is different, in one or two plain sentences. */
  note: text,
  /** How it is written in SQLite (the game). */
  sqlite: text,
  /** How it is written in this dialect. */
  dialect: text,
});

export const dialectPackSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** Shown once at the top of the notes. */
  intro: text,
  entries: z.partialRecord(z.enum(DIALECT_QUIRKS), dialectEntrySchema),
});
export type DialectPack = z.infer<typeof dialectPackSchema>;

const packId = z.string().regex(/^[a-z][a-z0-9-]{0,30}$/);

export const dialectSettingsSchema = z.object({
  packs: z.record(packId, dialectPackSchema),
});
export type DialectSettings = z.infer<typeof dialectSettingsSchema>;

/** The game's own engine: a class on it gets no notes. */
export const ENGINE_DIALECT = 'sqlite';

const POSTGRES: DialectPack = {
  name: 'PostgreSQL',
  intro:
    'The game runs SQLite. Your class uses PostgreSQL: the answer here is graded in SQLite, and these notes show how it would differ in PostgreSQL.',
  entries: {
    'integer-division': {
      note: 'Whole numbers divide to a whole number in both. Make one side a decimal for decimals.',
      sqlite: 'SELECT 7 / 2;  -- 3   ·  7 / 2.0  -- 3.5',
      dialect: 'SELECT 7 / 2;  -- 3   ·  7 / 2.0  -- 3.5   ·  7::numeric / 2',
    },
    'string-concat': {
      note: '|| joins text in both; NULL anywhere gives NULL. concat() skips NULLs.',
      sqlite: "first_name || ' ' || last_name",
      dialect: "first_name || ' ' || last_name   ·   concat(first_name, ' ', last_name)",
    },
    'limit-offset': {
      note: 'LIMIT and OFFSET work the same; the SQL standard form also works.',
      sqlite: 'LIMIT 5 OFFSET 10',
      dialect: 'LIMIT 5 OFFSET 10   ·   OFFSET 10 ROWS FETCH FIRST 5 ROWS ONLY',
    },
    dates: {
      note: 'Dates are real types with their own functions, not text.',
      sqlite: "strftime('%Y', at)   ·   date(at, '+1 day')",
      dialect: "EXTRACT(YEAR FROM at)   ·   at + INTERVAL '1 day'   ·   date_trunc('month', at)",
    },
    'like-case': {
      note: 'LIKE cares about upper and lower case in PostgreSQL. ILIKE ignores it.',
      sqlite: "name LIKE 'a%'   -- matches Ana and ana",
      dialect: "name ILIKE 'a%'   -- LIKE 'a%' would miss Ana",
    },
    'bare-columns': {
      note: 'Every selected column must be grouped or aggregated; SQLite lets it slide.',
      sqlite: 'SELECT dept, name, MAX(salary) FROM staff GROUP BY dept;  -- runs',
      dialect: 'ERROR: column "name" must appear in the GROUP BY clause or be used in an aggregate',
    },
    'nulls-order': {
      note: 'NULLs sort last going up in PostgreSQL, first in SQLite. Say which you want.',
      sqlite: 'ORDER BY bonus   -- NULLs first',
      dialect: 'ORDER BY bonus   -- NULLs last   ·   ORDER BY bonus NULLS FIRST',
    },
    upsert: {
      note: 'Insert-or-update names the conflicting column.',
      sqlite: 'INSERT INTO t (id, v) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET v = excluded.v;',
      dialect: 'INSERT INTO t (id, v) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v;',
    },
    types: {
      note: 'Column types are enforced; convert on purpose.',
      sqlite: "CAST(amount AS TEXT)   -- and '12' + 1 is 13",
      dialect: "amount::text   ·   '12'::int + 1",
    },
    autoincrement: {
      note: 'A counting id is declared differently.',
      sqlite: 'id INTEGER PRIMARY KEY',
      dialect: 'id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
    },
    boolean: {
      note: 'There is a real true/false type.',
      sqlite: 'WHERE active = 1',
      dialect: 'WHERE active   ·   WHERE active = true',
    },
    quoting: {
      note: '"Double quotes" are always names, \'single quotes\' always text.',
      sqlite: 'SELECT "order" FROM orders WHERE kind = \'cash\';',
      dialect: 'SELECT "order" FROM orders WHERE kind = \'cash\';',
    },
  },
};

const MYSQL: DialectPack = {
  name: 'MySQL',
  intro:
    'The game runs SQLite. Your class uses MySQL: the answer here is graded in SQLite, and these notes show how it would differ in MySQL.',
  entries: {
    'integer-division': {
      note: '/ always gives a decimal in MySQL. DIV gives the whole-number result.',
      sqlite: 'SELECT 7 / 2;  -- 3',
      dialect: 'SELECT 7 / 2;  -- 3.5000   ·   7 DIV 2  -- 3',
    },
    'string-concat': {
      note: '|| means OR in MySQL by default. Join text with CONCAT().',
      sqlite: "first_name || ' ' || last_name",
      dialect: "CONCAT(first_name, ' ', last_name)",
    },
    'limit-offset': {
      note: 'LIMIT works; there is also a short form with the offset first.',
      sqlite: 'LIMIT 5 OFFSET 10',
      dialect: 'LIMIT 5 OFFSET 10   ·   LIMIT 10, 5',
    },
    dates: {
      note: 'Dates have their own type and functions.',
      sqlite: "strftime('%Y', at)   ·   date(at, '+1 day')",
      dialect: "YEAR(at)   ·   DATE_ADD(at, INTERVAL 1 DAY)   ·   DATE_FORMAT(at, '%Y-%m')",
    },
    'like-case': {
      note: 'LIKE usually ignores case (it follows the column collation).',
      sqlite: "name LIKE 'a%'",
      dialect: "name LIKE 'a%'   ·   name LIKE BINARY 'a%'  -- case-sensitive",
    },
    'bare-columns': {
      note: 'With ONLY_FULL_GROUP_BY (the default) every selected column must be grouped or aggregated.',
      sqlite: 'SELECT dept, name, MAX(salary) FROM staff GROUP BY dept;  -- runs',
      dialect: "ERROR 1055: 'name' isn't in GROUP BY",
    },
    'nulls-order': {
      note: 'NULLs sort first going up, as in SQLite. There is no NULLS LAST.',
      sqlite: 'ORDER BY bonus',
      dialect: 'ORDER BY bonus IS NULL, bonus   -- NULLs last',
    },
    upsert: {
      note: 'Insert-or-update uses ON DUPLICATE KEY.',
      sqlite: 'INSERT INTO t (id, v) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET v = excluded.v;',
      dialect: 'INSERT INTO t (id, v) VALUES (1, 2) ON DUPLICATE KEY UPDATE v = VALUES(v);',
    },
    types: {
      note: 'Values are converted silently (strict mode refuses bad ones).',
      sqlite: 'CAST(amount AS TEXT)',
      dialect: 'CAST(amount AS CHAR)',
    },
    autoincrement: {
      note: 'A counting id uses AUTO_INCREMENT.',
      sqlite: 'id INTEGER PRIMARY KEY',
      dialect: 'id INT AUTO_INCREMENT PRIMARY KEY',
    },
    boolean: {
      note: 'BOOLEAN is TINYINT(1): TRUE is 1.',
      sqlite: 'WHERE active = 1',
      dialect: 'WHERE active   ·   WHERE active = TRUE',
    },
    quoting: {
      note: 'Names are quoted with backticks; "double quotes" can be text.',
      sqlite: 'SELECT "order" FROM orders;',
      dialect: 'SELECT `order` FROM orders;',
    },
  },
};

export const DEFAULT_DIALECT_SETTINGS: DialectSettings = {
  packs: {
    sqlite: { name: 'SQLite', intro: 'The game and your class both use SQLite.', entries: {} },
    postgres: POSTGRES,
    mysql: MYSQL,
  },
};

const PATTERNS: readonly [DialectQuirk, RegExp][] = [
  ['integer-division', /[\w)]\s*\/\s*[\w(]/],
  ['string-concat', /\|\|/],
  ['limit-offset', /\b(LIMIT|OFFSET)\b/i],
  ['dates', /\b(strftime|julianday|datetime|date)\s*\(/i],
  ['like-case', /\bLIKE\b/i],
  ['upsert', /\bON\s+CONFLICT\b|\bOR\s+REPLACE\b|\bREPLACE\s+INTO\b/i],
  ['types', /\bCAST\s*\(|\btypeof\s*\(/i],
  ['autoincrement', /\bAUTOINCREMENT\b|\bINTEGER\s+PRIMARY\s+KEY\b/i],
  ['quoting', /"[A-Za-z_]/],
];

/** The quirks some SQL touches, found by pattern (a question can add more by hand). */
export function detectQuirks(...sql: readonly string[]): DialectQuirk[] {
  const all = sql.join('\n');
  return PATTERNS.filter(([, re]) => re.test(all)).map(([q]) => q);
}
