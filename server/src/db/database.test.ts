import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, schemaVersion } from './database';
import { migrations } from './migrations';

function tableNames(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

describe('openDatabase', () => {
  it('migrates an empty database to the latest schema', () => {
    const db = openDatabase({ path: ':memory:' });
    expect(schemaVersion(db)).toBe(migrations.length);
    expect(tableNames(db)).toEqual([
      'audit_log',
      'question_topics',
      'question_versions',
      'questions',
      'reward_map',
      'sessions',
      'settings',
      'users',
    ]);
  });

  it('is idempotent when run twice', () => {
    const db = openDatabase({ path: ':memory:' });
    expect(migrate(db, migrations)).toBe(migrations.length);
  });

  it('enforces foreign keys', () => {
    const db = openDatabase({ path: ':memory:' });
    expect(() => db.prepare("INSERT INTO question_topics VALUES (999, 'joins')").run()).toThrow(
      /FOREIGN KEY/,
    );
  });
});

describe('migrate', () => {
  it('rolls back a failing migration and leaves the version unchanged', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (x); NOT SQL'])).toThrow(
      /migration 2 failed/,
    );
    expect(schemaVersion(db)).toBe(1);
    expect(tableNames(db)).toEqual(['a']);
  });

  it('refuses a database newer than the code', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 99');
    expect(() => migrate(db, migrations)).toThrow(/newer than this code/);
  });
});
