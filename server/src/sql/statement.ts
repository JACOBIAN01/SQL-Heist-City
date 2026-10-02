/**
 * Minimal SQL lexer: enough to find statement boundaries and the leading
 * keyword while respecting strings, quoted identifiers and comments.
 * This is a pre-check only; the SQLite authorizer is the real guard.
 */

export type StatementCheck =
  | { ok: true; sql: string }
  | { ok: false; reason: 'empty' | 'multiple_statements' | 'not_a_query' | 'unterminated' };

const ALLOWED_FIRST_KEYWORDS = new Set(['SELECT', 'WITH']);

export function checkSingleQuery(input: string): StatementCheck {
  const scan = scanStatements(input);
  if (scan === 'unterminated') return { ok: false, reason: 'unterminated' };
  const statements = scan.filter((s) => s.hasCode);
  if (statements.length === 0) return { ok: false, reason: 'empty' };
  if (statements.length > 1) return { ok: false, reason: 'multiple_statements' };
  const only = statements[0] as ScannedStatement;
  if (!ALLOWED_FIRST_KEYWORDS.has(only.firstWord.toUpperCase())) {
    return { ok: false, reason: 'not_a_query' };
  }
  return { ok: true, sql: only.text.trim() };
}

interface ScannedStatement {
  text: string;
  /** Contains something other than whitespace/comments. */
  hasCode: boolean;
  firstWord: string;
}

function scanStatements(sql: string): ScannedStatement[] | 'unterminated' {
  const out: ScannedStatement[] = [];
  let start = 0;
  let hasCode = false;
  let firstWord = '';
  let i = 0;

  const closeQuote = (quote: string): boolean => {
    // Handles doubled quotes ('it''s') by continuing past them.
    for (i++; i < sql.length; i++) {
      if (sql[i] === quote) {
        if (sql[i + 1] === quote && quote !== ']') {
          i++;
          continue;
        }
        return true;
      }
    }
    return false;
  };

  while (i < sql.length) {
    const c = sql[i] as string;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return 'unterminated';
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      hasCode = true;
      if (!closeQuote(c === '[' ? ']' : c)) return 'unterminated';
      i++;
      continue;
    }
    if (c === ';') {
      out.push({ text: sql.slice(start, i), hasCode, firstWord });
      start = i + 1;
      hasCode = false;
      firstWord = '';
      i++;
      continue;
    }
    if (!/\s/.test(c)) {
      if (!hasCode) {
        const word = /^[A-Za-z_]+/.exec(sql.slice(i));
        firstWord = word ? word[0] : c;
      }
      hasCode = true;
    }
    i++;
  }
  out.push({ text: sql.slice(start), hasCode, firstWord });
  return out;
}
