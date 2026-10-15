import { z } from 'zod';

const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a plain SQL name');

/**
 * A story theme for a question (structural variant, Phase 17.12): the same task with its tables,
 * columns and words renamed, e.g. a bank's accounts become a casino's players. Grading is the
 * same because the reference query is renamed with everything else.
 */
export const themeSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
  /** Optional title under this theme. */
  title: z.string().min(1).max(120).optional(),
  /** Old table name → new table name. */
  tables: z.record(name, name).default({}),
  /** Old column name → new column name (in every table that has it). */
  columns: z.record(name, name).default({}),
  /** Words of the story, prompts and options to swap (whole words; a capital stays a capital). */
  words: z.record(z.string().min(1).max(40), z.string().min(1).max(40)).default({}),
});

export type Theme = z.infer<typeof themeSchema>;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wordPattern(words: readonly string[]): RegExp | null {
  if (words.length === 0) return null;
  // Longest first, so "account_id" wins over "account".
  const sorted = [...words].sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`(?<![A-Za-z0-9_])(${sorted.join('|')})(?![A-Za-z0-9_])`, 'gi');
}

/** Renames tables and columns in SQL, leaving text inside '…' literals alone. */
export function themeSql(sql: string, theme: Theme | null | undefined): string {
  if (!theme) return sql;
  const map = new Map<string, string>();
  for (const [from, to] of Object.entries(theme.columns)) map.set(from.toLowerCase(), to);
  for (const [from, to] of Object.entries(theme.tables)) map.set(from.toLowerCase(), to);
  const pattern = wordPattern([...Object.keys(theme.tables), ...Object.keys(theme.columns)]);
  if (!pattern) return sql;
  // Split into string literals (kept) and the rest (renamed).
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(pattern, (m) => map.get(m.toLowerCase()) ?? m),
    )
    .join('');
}

/**
 * Swaps the theme's words in prose, and renames tables and columns inside `code` spans (where a
 * story or option names them).
 */
export function themeText(text: string, theme: Theme | null | undefined): string {
  if (!theme) return text;
  const words = new Map(Object.entries(theme.words).map(([k, v]) => [k.toLowerCase(), v]));
  const pattern = wordPattern(Object.keys(theme.words));
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `\`${themeSql(part.slice(1, -1), theme)}\``;
      if (!pattern) return part;
      return part.replace(pattern, (m) => {
        const to = words.get(m.toLowerCase()) ?? m;
        return m[0] === m[0]?.toUpperCase() && m[0] !== m[0]?.toLowerCase()
          ? to.charAt(0).toUpperCase() + to.slice(1)
          : to;
      });
    })
    .join('');
}

/** Bold names in a story (**balance**) are column names too: rename them like code spans. */
export function themeStory(text: string, theme: Theme | null | undefined): string {
  if (!theme) return text;
  return themeText(text, theme)
    .split(/(\*\*[^*]+\*\*)/)
    .map((part, i) => (i % 2 === 1 ? `**${themeSql(part.slice(2, -2), theme)}**` : part))
    .join('');
}
