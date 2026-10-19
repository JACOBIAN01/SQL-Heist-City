#!/usr/bin/env node
// Starts the whole game for the browser tests: a fresh database with the real questions, the game
// server, the admin service and the client, on their usual ports. Answers 200 on :5199 once all
// four are up (that is what Playwright waits for), and stops everything when it is stopped.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data', 'e2e');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

export const E2E_ADMIN = { email: 'e2e-admin@school.test', password: 'e2e-only-not-a-real-secret' };
const env = {
  ...process.env,
  DB_PATH: join(dir, 'e2e.db'),
  SNAPSHOT_PATH: join(dir, 'snapshot.json'),
  ADMIN_EMAIL: E2E_ADMIN.email,
  ADMIN_PASSWORD: E2E_ADMIN.password,
  DEV_LOGIN: '1',
  INTERNAL_SECRET: 'e2e-internal',
  GAME_SERVER_URL: 'http://localhost:8080',
  NODE_ENV: 'development',
};

const seed = spawnSync('npm', ['run', 'db:seed', '-w', '@heist/admin'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (seed.status !== 0) process.exit(1);

const children = [
  ['game', 'npm', ['run', 'start', '-w', '@heist/server']],
  ['admin', 'npm', ['run', 'start', '-w', '@heist/admin']],
  ['client', 'npm', ['run', 'dev', '-w', '@heist/client', '--', '--port', '5173', '--strictPort']],
].map(([name, cmd, args]) => {
  const child = spawn(cmd, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const tag = (d) => process.stderr.write(`[${name}] ${d}`);
  child.stdout.on('data', tag);
  child.stderr.on('data', tag);
  child.on('exit', (code) => {
    if (!stopping) {
      process.stderr.write(`[${name}] exited early (${code})\n`);
      stop(1);
    }
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());

const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
createServer(async (_req, res) => {
  const ready = (
    await Promise.all(
      [
        'http://localhost:8080/health',
        'http://localhost:8081/health',
        'http://localhost:5173/',
      ].map(up),
    )
  ).every(Boolean);
  res.writeHead(ready ? 200 : 503).end();
}).listen(5199);
