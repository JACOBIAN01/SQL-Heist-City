import { CONSENT_VERSION } from '@heist/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  DEFAULT_CITY_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  classInputSchema,
  decodeServerMessages,
  SnapshotDecoder,
  encodeClientMessage,
  type ServerMessage,
} from '@heist/shared';
import type { RoundResult } from '../heist/HeistEvents';
import { issueTicket } from '../auth/ticket';
import { openDatabase } from '../db/database';
import { MatchPool } from '../game/MatchPool';
import { InMemoryClassRepository } from './ClassRepository';
import { ClassRooms } from './ClassRooms';

const SECRET = 'rooms-test-secret-rooms-test-secret';
let dir: string;
let pool: MatchPool;
let classes: InMemoryClassRepository;
let rooms: ClassRooms;
const finished: { classId: number; result: RoundResult }[] = [];
const sockets: WebSocket[] = [];

beforeEach(() => {
  dir = mkdtempSync(joinPath(tmpdir(), 'heist-rooms-'));
  const dbPath = joinPath(dir, 'game.db');
  openDatabase({ path: dbPath }).close();
  finished.length = 0;
  pool = new MatchPool((classId, result) => finished.push({ classId, result }));
  classes = new InMemoryClassRepository();
  rooms = new ClassRooms({
    classes,
    pool,
    matchSettings: { ...DEFAULT_MATCH_SETTINGS, sandboxDummies: 0 },
    extras: () => ({ dbPath, ticketSecret: SECRET, requireTicket: true }),
    city: () => DEFAULT_CITY_SETTINGS,
    heist: () => DEFAULT_HEIST_SETTINGS,
  });
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await pool.stop();
  rmSync(dir, { recursive: true, force: true });
});

interface Client {
  ws: WebSocket;
  messages: ServerMessage[];
  closed: Promise<{ code: number; reason: string }>;
}

/** A headless student: connects with a ticket for `classId` and records what the room sends. */
function student(port: number, accountId: number, classId: number): Client {
  const ws = new WebSocket(`ws://localhost:${port}/ws/game`);
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  ws.on('open', () =>
    ws.send(
      encodeClientMessage({
        t: 'join',
        protocol: PROTOCOL_VERSION,
        name: `S${accountId}`,
        ticket: issueTicket(SECRET, { id: accountId, name: `Student ${accountId}`, classId }),
      }),
    ),
  );
  // One decoder per client: snapshots after the first are changes against the last.
  const decoder = new SnapshotDecoder();
  ws.on('message', (data: Buffer) =>
    messages.push(...decodeServerMessages(new Uint8Array(data), decoder)),
  );
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  return { ws, messages, closed };
}
const welcomed = (c: Client) => c.messages.some((m) => m.t === 'welcome');
const until = async (check: () => boolean, ms = 20000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  expect(check()).toBe(true);
};
// The school has accepted the terms, as a class needs before it can start (Phase 21.3).
const make = async (name: string, over: object = {}) => {
  const made = await classes.create(classInputSchema.parse({ name, ...over }), null);
  return (await classes.acceptConsent(made.id, CONSENT_VERSION, null)) ?? made;
};

// Phase 23.3: two classes of 100 at the same time, every student heard from for a while. It is
// heavy (200 sockets, two match threads), so it runs nightly (MULTIPLAYER=1), not on every push.
describe.skipIf(!process.env.MULTIPLAYER)('two full classes at once (23.3)', () => {
  it('both classes fill to 100, stay connected, and keep the tick inside its budget', async () => {
    const [a, b] = [await make('A', { playerCap: 100 }), await make('B', { playerCap: 100 })];
    const [ra, rb] = await Promise.all([
      rooms.handle(a.id, { action: 'start' }),
      rooms.handle(b.id, { action: 'start' }),
    ]);
    const portA = (ra.ok && ra.status.port) as number;
    const portB = (rb.ok && rb.status.port) as number;
    const inA = Array.from({ length: 100 }, (_, i) => student(portA, i + 1, a.id));
    const inB = Array.from({ length: 100 }, (_, i) => student(portB, 1000 + i, b.id));
    await until(() => [...inA, ...inB].every(welcomed), 120000);
    await until(
      () => rooms.status(a.id).players === 100 && rooms.status(b.id).players === 100,
      30000,
    );

    // Ten seconds of play: nobody is dropped and both rooms keep sending snapshots.
    const before = [...inA, ...inB].map((c) => c.messages.length);
    await new Promise((r) => setTimeout(r, 10000));
    const after = [...inA, ...inB].map((c) => c.messages.length);
    expect(after.every((n, i) => n > (before[i] as number))).toBe(true);
    expect(rooms.status(a.id).players).toBe(100);
    expect(rooms.status(b.id).players).toBe(100);

    // The server's own numbers, per room thread: the tick budget at 100 players is 15 ms.
    const numbers = Object.values(pool.metrics()).filter((m) => m !== undefined);
    expect(numbers).toHaveLength(2);
    for (const m of numbers) expect(m?.tickMs.p95).toBeLessThan(15);
  }, 300000);
});
