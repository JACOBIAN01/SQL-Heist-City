#!/usr/bin/env node
// A private PostgreSQL for development and tests (docs/identity.md §Storage).
// It lives in data/pg on its own port and never touches any PostgreSQL you already run.
//   node scripts/pg-dev.mjs start|stop|status|url
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PG_PORT = Number(process.env.PG_DEV_PORT ?? 54329);
const dataDir = process.env.PG_DEV_DATA ?? join(root, 'data', 'pg');
export const devUrl = (db = 'heist') => `postgres://heist@127.0.0.1:${PG_PORT}/${db}`;

/** Where PostgreSQL's programs are: PG_BIN, the usual install folders, or the PATH. */
export function findPgBin() {
  const candidates = [process.env.PG_BIN].filter(Boolean);
  for (const base of ['/Library/PostgreSQL', '/usr/lib/postgresql']) {
    if (existsSync(base)) {
      for (const v of readdirSync(base).sort().reverse()) {
        candidates.push(join(base, v, 'bin'));
      }
    }
  }
  for (const brew of ['/opt/homebrew/opt', '/usr/local/opt']) {
    if (existsSync(brew)) {
      for (const d of readdirSync(brew).filter((n) => n.startsWith('postgresql'))) {
        candidates.push(join(brew, d, 'bin'));
      }
    }
  }
  for (const dir of candidates) if (existsSync(join(dir, 'pg_ctl'))) return dir;
  const onPath = spawnSync('which', ['pg_ctl'], { encoding: 'utf8' });
  return onPath.status === 0 ? dirname(onPath.stdout.trim()) : undefined;
}

function run(bin, program, args, options = {}) {
  return execFileSync(join(bin, program), args, { encoding: 'utf8', stdio: 'pipe', ...options });
}

export function isRunning(bin) {
  return (
    existsSync(dataDir) &&
    spawnSync(join(bin, 'pg_ctl'), ['status', '-D', dataDir], { stdio: 'ignore' }).status === 0
  );
}

/** Starts the cluster (creating it the first time) and makes sure both databases exist. */
export function start() {
  const bin = findPgBin();
  if (!bin) throw new Error('PostgreSQL programs not found: install PostgreSQL or set PG_BIN');
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    run(bin, 'initdb', ['-D', dataDir, '-U', 'heist', '--auth=trust', '-E', 'UTF8']);
  }
  if (!isRunning(bin)) {
    run(bin, 'pg_ctl', [
      'start',
      '-D',
      dataDir,
      '-l',
      join(dataDir, 'server.log'),
      '-w',
      '-o',
      `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dataDir}`,
    ]);
  }
  for (const db of ['heist', 'heist_test']) {
    const exists = run(bin, 'psql', [
      '-h',
      '127.0.0.1',
      '-p',
      String(PG_PORT),
      '-U',
      'heist',
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname = '${db}'`,
    ]).trim();
    if (!exists) {
      run(bin, 'createdb', ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'heist', db]);
    }
  }
  return devUrl();
}

export function stop() {
  const bin = findPgBin();
  if (bin && isRunning(bin)) run(bin, 'pg_ctl', ['stop', '-D', dataDir, '-m', 'fast', '-w']);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === 'start') console.log(`started: ${start()}`);
    else if (command === 'stop') stop();
    else if (command === 'url') console.log(devUrl());
    else if (command === 'status') {
      const bin = findPgBin();
      console.log(bin && isRunning(bin) ? `running on ${PG_PORT}` : 'stopped');
    } else console.log('usage: node scripts/pg-dev.mjs start|stop|status|url');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
