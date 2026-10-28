import { describe, expect, it } from 'vitest';
import { betterCost, queryCost, queryLength } from './queryCost';

describe('query cost (34.4)', () => {
  it('measures a query without comments or spare whitespace', () => {
    expect(queryLength('SELECT   name\n  FROM employees -- all of them\n WHERE id = 1')).toBe(
      'SELECT name FROM employees WHERE id = 1'.length,
    );
    expect(queryLength('SELECT /* hi */ 1')).toBe('SELECT 1'.length);
  });

  it('counts a full scan as the whole table and a search as an index lookup', () => {
    const rows = { employees: 1000, departments: 20 };
    const scan = queryCost(['SCAN employees', 'SCAN departments'], rows, 'x');
    expect(scan.scanned).toBe(1020);
    const search = queryCost(
      ['SCAN departments', 'SEARCH employees USING INDEX i (dept=?)'],
      rows,
      'x',
    );
    expect(search.scanned).toBe(20 + 10);
    expect(search.scanned).toBeLessThan(scan.scanned);
  });

  it('ignores steps it cannot price, and table names in any case', () => {
    expect(
      queryCost(['USE TEMP B-TREE FOR ORDER BY', 'SCAN SUBQUERY 2'], { t: 5 }, 'x').scanned,
    ).toBe(0);
    expect(queryCost(['SCAN Employees'], { employees: 7 }, 'x').scanned).toBe(7);
  });

  it('ranks fewer rows scanned first, then a shorter query', () => {
    expect(betterCost({ scanned: 10, length: 90 }, { scanned: 20, length: 10 })).toBe(true);
    expect(betterCost({ scanned: 10, length: 40 }, { scanned: 10, length: 60 })).toBe(true);
    expect(betterCost({ scanned: 10, length: 60 }, { scanned: 10, length: 60 })).toBe(false);
  });
});
