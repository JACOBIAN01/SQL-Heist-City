import { describe, expect, it } from 'vitest';
import { executeJob } from './SandboxRunner';
import { SqlSandbox } from './SqlSandbox';

const data = {
  schemaSql:
    'CREATE TABLE accounts (id INTEGER PRIMARY KEY, owner TEXT, balance INTEGER); CREATE INDEX accounts_owner ON accounts (owner);',
  tables: new Map([
    [
      'accounts',
      {
        columns: ['id', 'owner', 'balance'],
        rows: [
          [1, 'Ana', 10],
          [2, 'Ben', 20],
        ],
      },
    ],
  ]) as never,
};

describe('sandbox plan mode (17.7)', () => {
  it('returns the plan lines, telling a full scan from an index search', () => {
    const s = SqlSandbox.create(data);
    expect(s.plan('SELECT * FROM accounts').join(' ')).toMatch(/SCAN accounts/);
    expect(s.plan("SELECT * FROM accounts WHERE owner = 'Ana'").join(' ')).toMatch(
      /SEARCH accounts USING (COVERING )?INDEX accounts_owner/,
    );
    expect(() => s.plan('DELETE FROM accounts')).toThrow();
  });
});

describe('sandbox write mode (17.8)', () => {
  it('lets a write task change the tables, then checks read-only', () => {
    const out = executeJob({
      data,
      queries: [
        {
          sql: "INSERT INTO accounts (owner, balance) VALUES ('Cy', 5); UPDATE accounts SET balance = balance + 1;",
          mode: 'write',
        },
        { sql: 'SELECT owner, balance FROM accounts ORDER BY id' },
      ],
    });
    expect(out.ok && out.outcomes[1]).toMatchObject({
      ok: true,
      result: {
        rows: [
          ['Ana', 11],
          ['Ben', 21],
          ['Cy', 6],
        ],
      },
    });
  });

  it("may create a table, but never attach, pragma, drop the question's tables or run a transaction", () => {
    const run = (sql: string) => executeJob({ data, queries: [{ sql, mode: 'write' }] });
    expect(run('CREATE TABLE audit (id INTEGER, note TEXT)')).toMatchObject({
      ok: true,
      outcomes: [{ ok: true }],
    });
    for (const bad of [
      "ATTACH DATABASE 'x.db' AS x",
      'PRAGMA query_only = 0',
      'DROP TABLE accounts',
      "UPDATE sqlite_master SET sql = 'x'",
      "INSERT INTO sqlite_master VALUES ('table', 'x', 'x', 0, 'CREATE TABLE x (a)')",
      'BEGIN; DELETE FROM accounts; COMMIT',
      "SELECT load_extension('x')",
      'CREATE TRIGGER t AFTER INSERT ON accounts BEGIN DELETE FROM accounts; END',
    ]) {
      const out = run(bad);
      expect(out.ok && out.outcomes[0]?.ok, bad).toBe(false);
    }
  });

  it('is read-only again for the check that follows', () => {
    const out = executeJob({
      data,
      queries: [
        { sql: 'DELETE FROM accounts WHERE id = 1', mode: 'write' },
        { sql: 'DELETE FROM accounts' },
        { sql: 'SELECT count(*) FROM accounts' },
      ],
    });
    expect(out.ok && out.outcomes[1]?.ok).toBe(false);
    expect(out.ok && out.outcomes[2]).toMatchObject({ ok: true, result: { rows: [[1]] } });
  });

  it('keeps ordinary query jobs read-only', () => {
    const out = executeJob({ data, queries: [{ sql: 'DELETE FROM accounts' }] });
    expect(out.ok && out.outcomes[0]?.ok).toBe(false);
  });
});
