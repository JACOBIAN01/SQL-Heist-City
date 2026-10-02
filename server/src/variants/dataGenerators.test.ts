import { describe, expect, it } from 'vitest';
import { SeededRng, tableSpecSchema, type TableSpec } from '@heist/shared';
import { builtInDatasets } from './datasets';
import { DataGenerationError, generateTables, type GeneratedTable } from './dataGenerators';

const tables = (raw: Record<string, unknown>): Record<string, TableSpec> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, tableSpecSchema.parse(v)]));

const gen = (raw: Record<string, unknown>, seed = 'seed') =>
  generateTables(tables(raw), new SeededRng(seed), builtInDatasets);

const column = (t: GeneratedTable | undefined, name: string) => {
  const i = t?.columns.indexOf(name) ?? -1;
  return (t?.rows ?? []).map((r) => r[i]);
};

const bank = {
  branches: {
    rows: 5,
    columns: { id: { kind: 'serial' }, city: { kind: 'pick', from: 'cities' } },
  },
  accounts: {
    rows: [20, 40],
    columns: {
      id: { kind: 'serial', start: 100 },
      branch_id: { kind: 'fk', table: 'branches', column: 'id' },
      number: { kind: 'text_pattern', pattern: 'ACC-####', unique: true },
      balance: { kind: 'real', min: 0, max: 5000, decimals: 2 },
      opened: { kind: 'date', from: '2020-01-01', to: '2024-12-31' },
      frozen: { kind: 'bool', p: 0.2 },
      tier: { kind: 'pick', from: ['gold', 'silver'], weights: [1, 3] },
      note: { kind: 'const', value: null },
    },
  },
};

describe('generateTables', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(gen(bank, 'a')).toEqual(gen(bank, 'a'));
    expect(gen(bank, 'a')).not.toEqual(gen(bank, 'b'));
  });

  it('honours row ranges, serial starts and column order', () => {
    const accounts = gen(bank).get('accounts');
    expect(accounts?.columns).toEqual(Object.keys(bank.accounts.columns));
    const n = accounts?.rows.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThanOrEqual(40);
    expect(column(accounts, 'id')).toEqual(Array.from({ length: n }, (_, i) => 100 + i));
  });

  it('generates values matching each spec', () => {
    const accounts = gen(bank).get('accounts');
    for (const v of column(accounts, 'number')) expect(v).toMatch(/^ACC-\d{4}$/);
    expect(new Set(column(accounts, 'number')).size).toBe(accounts?.rows.length);
    for (const v of column(accounts, 'balance')) {
      expect(v as number).toBeGreaterThanOrEqual(0);
      expect(Math.round((v as number) * 100)).toBeCloseTo((v as number) * 100, 6);
    }
    for (const v of column(accounts, 'opened')) expect(v).toMatch(/^202[0-4]-/);
    for (const v of column(accounts, 'frozen')) expect([0, 1]).toContain(v);
    for (const v of column(accounts, 'note')) expect(v).toBeNull();
  });

  it('foreign keys only reference generated parent ids', () => {
    const result = gen(bank);
    const parentIds = new Set(column(result.get('branches'), 'id'));
    for (const v of column(result.get('accounts'), 'branch_id'))
      expect(parentIds.has(v)).toBe(true);
  });

  it('applies null_rate roughly as configured', () => {
    const t = gen({
      t: { rows: 1000, columns: { x: { kind: 'int', min: 1, max: 9, null_rate: 0.3 } } },
    }).get('t');
    const nulls = column(t, 'x').filter((v) => v === null).length;
    expect(nulls).toBeGreaterThan(240);
    expect(nulls).toBeLessThan(360);
  });

  it('changing one column does not change other columns', () => {
    const a = gen({
      t: {
        rows: 30,
        columns: { x: { kind: 'int', min: 0, max: 1e6 }, y: { kind: 'int', min: 0, max: 9 } },
      },
    });
    const b = gen({
      t: {
        rows: 30,
        columns: { x: { kind: 'int', min: 0, max: 1e6 }, y: { kind: 'int', min: 50, max: 99 } },
      },
    });
    expect(column(a.get('t'), 'x')).toEqual(column(b.get('t'), 'x'));
  });

  it('tree_parent builds a forest: parents are always earlier rows', () => {
    const t = gen({
      staff: {
        rows: 50,
        columns: {
          id: { kind: 'serial', start: 10 },
          boss_id: { kind: 'tree_parent', start: 10, roots: 2 },
        },
      },
    }).get('staff');
    const ids = column(t, 'id') as number[];
    const bosses = column(t, 'boss_id');
    expect(bosses.slice(0, 2)).toEqual([null, null]);
    bosses.slice(2).forEach((b, i) => {
      expect(b as number).toBeGreaterThanOrEqual(10);
      expect(b as number).toBeLessThan(ids[i + 2] as number);
    });
  });

  it('fails clearly when a unique pattern is exhausted', () => {
    expect(() =>
      gen({
        t: { rows: 20, columns: { c: { kind: 'text_pattern', pattern: 'X#', unique: true } } },
      }),
    ).toThrow(DataGenerationError);
  });
});
