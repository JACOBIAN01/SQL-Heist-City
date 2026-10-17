import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { backup, restoreDrill } from './pgBackup';

const dirs: string[] = [];
const drops: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  await Promise.all(drops.map((d) => d()));
});

describe.skipIf(!TEST_DATABASE_URL)('PostgreSQL backup and restore drill (20.3)', () => {
  it('restores a dump into a scratch database that matches the source, and cleans up', async () => {
    const { db, drop } = await freshPg();
    drops.push(drop);
    await db.query("INSERT INTO settings (key, value_json) VALUES ('a', '{\"x\":1}'), ('b', '[]')");
    const outDir = mkdtempSync(join(tmpdir(), 'heist-backup-'));
    dirs.push(outDir);
    const url = TEST_DATABASE_URL as string;
    const schema = db.schema as string;
    const b = backup({ url, outDir, schema });
    expect(b.bytes).toBeGreaterThan(0);
    const drill = await restoreDrill({ url, file: b.file, schema });
    expect(drill.mismatches).toEqual([]);
    expect(drill.tables).toBeGreaterThan(10);
    expect(drill.rows).toBeGreaterThanOrEqual(2);
    // The scratch database is gone.
    const left = await db.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = $1',
      [drill.scratch],
    );
    expect(left).toEqual([]);
  }, 60_000);

  it('notices a restore that does not match (a table changed after the backup)', async () => {
    const { db, drop } = await freshPg();
    drops.push(drop);
    const outDir = mkdtempSync(join(tmpdir(), 'heist-backup-'));
    dirs.push(outDir);
    const url = TEST_DATABASE_URL as string;
    const schema = db.schema as string;
    const b = backup({ url, outDir, schema });
    await db.query("INSERT INTO settings (key, value_json) VALUES ('late', '1')");
    const drill = await restoreDrill({ url, file: b.file, schema });
    expect(drill.mismatches).toEqual(['settings: source 1, restored 0']);
  }, 60_000);

  it('keeps only the newest files', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'heist-backup-'));
    dirs.push(outDir);
    const url = TEST_DATABASE_URL as string;
    for (let i = 0; i < 4; i++)
      backup({
        url,
        outDir,
        keep: 2,
        schema: 'public',
        now: () => new Date(Date.UTC(2026, 9, 1 + i)),
      });
    expect(readdirSync(outDir).sort()).toEqual([
      'heist-20261003T000000.dump',
      'heist-20261004T000000.dump',
    ]);
  }, 60_000);
});
