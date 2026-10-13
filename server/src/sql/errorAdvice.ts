/**
 * Plain-language advice for the errors SQLite gives (Phase 16.4). The raw
 * message is still shown; this says what it usually means and what to try.
 * It describes the student's own query only, never the answer.
 */
interface Rule {
  readonly match: RegExp;
  readonly advice: (m: RegExpExecArray) => string;
}

const q = (s: string | undefined) => (s ? `"${s}"` : 'that name');

const RULES: readonly Rule[] = [
  {
    match: /no such column: ?([\w."]+)/i,
    advice: (m) =>
      `There is no column ${q(m[1])} in the tables you used. Check the spelling against the table list on the left, and whether it belongs to a different table (then write table.column). A word in double quotes is read as a column name; use single quotes for text.`,
  },
  {
    match: /no such table: ?([\w."]+)/i,
    advice: (m) =>
      `There is no table ${q(m[1])}. Look at the table names on the left, and check the spelling after FROM or JOIN.`,
  },
  {
    match: /ambiguous column name: ?([\w."]+)/i,
    advice: (m) =>
      `The column ${q(m[1])} exists in more than one table you joined, so SQL cannot tell which you mean. Put the table (or its alias) in front: e.g. e.${(m[1] ?? 'id').replace(/"/g, '')}.`,
  },
  {
    match: /near "?([^":]*)"?: syntax error/i,
    advice: (m) =>
      `SQL got confused at ${q(m[1])}. Look just before it: a missing comma between columns, an extra comma before FROM, a missing keyword, or clauses in the wrong order (SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT).`,
  },
  {
    match: /incomplete input/i,
    advice: () =>
      'The query stops too soon. Check for an unclosed bracket or quote, or a clause that needs something after it (like WHERE with no condition).',
  },
  {
    match: /unrecognized token: ?"?([^"]*)"?/i,
    advice: (m) =>
      `SQL does not understand ${q(m[1])}. This is usually an unclosed quote, a stray symbol, or a number with letters in it.`,
  },
  {
    match: /misuse of aggregate/i,
    advice: () =>
      'An aggregate (COUNT, SUM, AVG, MIN, MAX) is in the wrong place. You cannot use one in WHERE: filter groups with HAVING, or compute it in a subquery first.',
  },
  {
    match: /no such function: ?([\w]+)/i,
    advice: (m) =>
      `SQLite has no function ${q(m[1])}. Check the spelling; some functions from other databases are called something else in SQLite (e.g. use strftime for dates, || to join text).`,
  },
  {
    match: /wrong number of arguments to function ([\w]+)/i,
    advice: (m) =>
      `${q(m[1])} was given too many or too few values. Check what goes between its brackets.`,
  },
  {
    match: /(\d+) values for (\d+) columns|sub-select returns (\d+) columns/i,
    advice: () =>
      'The number of values does not match. A subquery used as a value must return exactly one column; an IN (...) subquery must return one column.',
  },
  {
    match: /ORDER BY term does not match any column/i,
    advice: () =>
      'With UNION, EXCEPT or INTERSECT you can only sort by a column of the result. Use the column name or its position (ORDER BY 1).',
  },
  {
    match: /GROUP BY term out of range|ORDER BY term out of range/i,
    advice: () => 'You used a column number bigger than the number of columns you selected.',
  },
  {
    match: /no tables specified/i,
    advice: () => 'SELECT * needs a table: add FROM and a table name.',
  },
  {
    match: /(?:circular reference|recursive reference)/i,
    advice: () =>
      'A recursive CTE must be written WITH RECURSIVE, with a starting query, UNION ALL, and a step that refers to the CTE once.',
  },
  {
    match: /only a single result allowed for a SELECT that is part of an expression/i,
    advice: () =>
      'A subquery used as a single value must return one row and one column. Add an aggregate or LIMIT 1, or use IN for a list.',
  },
  {
    match: /interrupted|timed? ?out/i,
    advice: () =>
      'The query ran too long. Look for a join with no condition (it multiplies every row by every row) or a recursive CTE with no stop.',
  },
  {
    match: /not authorized|authorization/i,
    advice: () => 'That statement is not allowed here. Use a SELECT (or WITH ... SELECT) query.',
  },
];

/** What an error usually means, in plain words; undefined when nothing helpful is known. */
export function adviceFor(message: string): string | undefined {
  for (const rule of RULES) {
    const m = rule.match.exec(message);
    if (m) return rule.advice(m);
  }
  return undefined;
}
