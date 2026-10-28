/** How lean a correct query is (Phase 34.4): the rows it had to look at, and how long it is to write. */
export interface QueryCost {
  /** An estimate of rows read, from the query plan: a full scan costs the table, an index search costs its depth. */
  readonly scanned: number;
  /** Characters of the query with comments and spare whitespace taken out. */
  readonly length: number;
}

/** The query's length without comments and runs of whitespace. */
export function queryLength(sql: string): number {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * The cost of a query from the lines of its `EXPLAIN QUERY PLAN` and the row count of each table.
 * It is an estimate, and honest about being one: SQLite does not say how many rows it read, so a
 * full `SCAN` of a table counts every row, a `SEARCH` counts the steps of an index lookup, and
 * anything else (a subquery, a sort) counts nothing. What it rewards is the right thing: using a key
 * instead of reading the whole table, and not reading a table twice.
 */
export function queryCost(
  planLines: readonly string[],
  tableRows: Readonly<Record<string, number>>,
  sql: string,
): QueryCost {
  const rows = new Map(Object.entries(tableRows).map(([k, v]) => [k.toLowerCase(), v]));
  let scanned = 0;
  for (const line of planLines) {
    const m = /\b(SCAN|SEARCH)\s+(?:TABLE\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
    if (!m) continue;
    const n = rows.get((m[2] as string).toLowerCase());
    if (n === undefined) continue;
    scanned +=
      (m[1] as string).toUpperCase() === 'SCAN' ? n : Math.max(1, Math.ceil(Math.log2(n + 1)));
  }
  return { scanned, length: queryLength(sql) };
}

/** Which of two costs is better: fewer rows scanned first, then a shorter query. */
export function betterCost(a: QueryCost, b: QueryCost): boolean {
  return a.scanned < b.scanned || (a.scanned === b.scanned && a.length < b.length);
}
