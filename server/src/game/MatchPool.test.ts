import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  SnapshotDecoder,
  decodeServerMessages,
  encodeClientMessage,
  type ServerMessage,
} from '@heist/shared';
import { openDatabase } from '../db/database';
import { MatchPool } from './MatchPool';

let pool: MatchPool | undefined;
afterEach(async () => {
  await pool?.stop();
  pool = undefined;
});

const settings = { ...DEFAULT_MATCH_SETTINGS, sandboxDummies: 2, maxPlayers: 5 };

/** Joins a match over a real socket and collects what it sends. */
function join(port: number) {
  const ws = new WebSocket(`ws://localhost:${port}/ws/game`);
  const messages: ServerMessage[] = [];
  const decoder = new SnapshotDecoder();
  ws.on('open', () =>
    ws.send(encodeClientMessage({ t: 'join', protocol: PROTOCOL_VERSION, name: 'T' })),
  );
  ws.on('message', (data: Buffer) =>
    messages.push(...decodeServerMessages(new Uint8Array(data), decoder)),
  );
  return { ws, messages };
}
const until = async (check: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  expect(check()).toBe(true);
};

describe('MatchPool', () => {
  it('runs a match in its own thread that real clients can join', async () => {
    pool = new MatchPool();
    const info = await pool.start(settings, 0, 'sandbox');
    expect(info.port).toBeGreaterThan(0);
    const c = join(info.port);
    await until(() => c.messages.some((m) => m.t === 'welcome'));
    await until(() => c.messages.some((m) => m.t === 'snapshot'));
    c.ws.terminate();
  }, 20000);

  it('keeps matches isolated: each has its own port and players', async () => {
    pool = new MatchPool();
    const [a, b] = await Promise.all([
      pool.start(settings, 0, 'sandbox'),
      pool.start(settings, 0, 'sandbox'),
    ]);
    expect(a.port).not.toBe(b.port);
    expect(
      pool
        .list()
        .map((m) => m.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    const c = join(a.port);
    await until(() => c.messages.some((m) => m.t === 'welcome'));
    // The other match never saw this player: its dummies are the only entities.
    const other = join(b.port);
    await until(() => other.messages.some((m) => m.t === 'snapshot'));
    const snap = other.messages.find((m) => m.t === 'snapshot');
    expect(snap?.t === 'snapshot' && snap.entities.length).toBe(2);
    c.ws.terminate();
    other.ws.terminate();
  }, 20000);

  it('reports player counts to the lobby and offers an open match', async () => {
    pool = new MatchPool();
    const info = await pool.start({ ...settings, maxPlayers: 3 }, 0, 'sandbox'); // 2 dummies + 1 slot
    const c = join(info.port);
    await until(() => c.messages.some((m) => m.t === 'welcome'));
    await until(() => (pool?.list()[0]?.players ?? 0) === 3, 10000);
    expect(pool.openMatch()).toBeUndefined();
    c.ws.terminate();
  }, 25000);

  it('serves interactions and SQL tasks from inside a match thread', async () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'heist-pool-'));
    const dbPath = joinPath(dir, 'game.db');
    openDatabase({ path: dbPath }).close();
    try {
      pool = new MatchPool();
      const info = await pool.start({ ...settings, sandboxDummies: 0 }, 0, 'heist', { dbPath });
      const c = join(info.port);
      await until(() => c.messages.some((m) => m.t === 'welcome'));
      const send = (m: object) =>
        c.ws.send(encodeClientMessage({ t: 'json', text: JSON.stringify(m) }));
      const answers = () =>
        c.messages.flatMap((m) => (m.t === 'json' ? [JSON.parse(m.text) as { t: string }] : []));

      // The vault state arrives on join.
      await until(() => answers().some((m) => m.t === 'vaults'));
      send({ t: 'interact', ref: 1, anchor: 'nowhere' });
      await until(() => answers().some((m) => m.t === 'interact_result'));
      // A vault task from the street is refused by the rules, before any question is drawn.
      send({
        t: 'challenge_request',
        ref: 2,
        rewardKey: 'vault:bank-1:lock-1',
        target: 'bank-1:vault',
      });
      await until(() => answers().some((m) => m.t === 'challenge'));
      expect(answers().find((m) => m.t === 'challenge')).toMatchObject({
        result: { ok: false, reason: 'not_allowed' },
      });
      c.ws.terminate();
    } finally {
      await pool?.stop();
      pool = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);

  it('stops cleanly', async () => {
    pool = new MatchPool();
    await pool.start(settings, 0, 'sandbox');
    await pool.stop();
    expect(pool.list()).toEqual([]);
    pool = undefined;
  }, 20000);
});
