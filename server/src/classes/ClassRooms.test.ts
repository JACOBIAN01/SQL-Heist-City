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

describe('class rooms (14.5, 14.6)', () => {
  it('a class waits until the teacher starts it, then has one room (a second start changes nothing)', async () => {
    const c = await make('9B');
    expect(rooms.status(c.id)).toEqual({ state: 'waiting' });
    const [a, b] = await Promise.all([
      rooms.handle(c.id, { action: 'start' }),
      rooms.handle(c.id, { action: 'start' }),
    ]);
    expect(a).toMatchObject({ ok: true, status: { state: 'live' } });
    expect(b).toMatchObject({ ok: true, status: { state: 'live' } });
    expect(pool.list().length).toBe(1);
    expect(rooms.status(c.id).mapId).toBe('city');
    expect(pool.openMatch()).toBeUndefined(); // a class room is never offered to open play
    expect(await rooms.handle(999, { action: 'start' })).toEqual({
      ok: false,
      reason: 'unknown_class',
    });
    expect(await rooms.handle(c.id, { action: 'next_round' })).toMatchObject({ ok: true });
  }, 40000);

  it('plays the class’s own city when the teacher set a seed', async () => {
    const c = await make('seeded', { citySeed: 'autumn' });
    await rooms.handle(c.id, { action: 'start' });
    expect(rooms.status(c.id).mapId).toBe('city:autumn');
  }, 40000);

  it('refuses to start an archived class, and says when a command has no room to go to', async () => {
    const c = await make('old');
    await classes.archive(c.id);
    expect(await rooms.handle(c.id, { action: 'start' })).toEqual({
      ok: false,
      reason: 'archived',
    });
    const d = await make('idle');
    expect(await rooms.handle(d.id, { action: 'end_round' })).toEqual({
      ok: false,
      reason: 'not_live',
    });
  }, 20000);

  it('100 students of one class land in the same match; the 101st is turned away', async () => {
    const c = await make('big', { playerCap: 100 });
    const started = await rooms.handle(c.id, { action: 'start' });
    const port = (started.ok && started.status.port) as number;
    const clients = Array.from({ length: 100 }, (_, i) => student(port, i + 1, c.id));
    await until(() => clients.every(welcomed), 60000);
    expect(rooms.status(c.id)).toMatchObject({ state: 'live', maxPlayers: 100 });
    await until(() => (rooms.status(c.id).players ?? 0) === 100, 15000);
    const extra = student(port, 101, c.id);
    expect((await extra.closed).code).toBe(4001); // match is full
  }, 120000);

  it('two classes at once never see each other: a ticket works only in its own class', async () => {
    const [a, b] = [await make('A'), await make('B')];
    const [ra, rb] = await Promise.all([
      rooms.handle(a.id, { action: 'start' }),
      rooms.handle(b.id, { action: 'start' }),
    ]);
    const portA = (ra.ok && ra.status.port) as number;
    const portB = (rb.ok && rb.status.port) as number;
    expect(portA).not.toBe(portB);
    const inA = student(portA, 1, a.id);
    const inB = student(portB, 2, b.id);
    await until(() => welcomed(inA) && welcomed(inB));
    const wrong = student(portB, 3, a.id); // an A ticket at B's door
    expect(await wrong.closed).toMatchObject({ code: 4005 });
    const A = rooms.status(a.id);
    const B = rooms.status(b.id);
    await until(
      () => (rooms.status(a.id).players ?? 0) === 1 && (rooms.status(b.id).players ?? 0) === 1,
    );
    expect([A.state, B.state]).toEqual(['live', 'live']);
  }, 60000);

  it('when the teacher ends a round, its results are reported with the students’ accounts', async () => {
    const c = await make('R');
    const started = await rooms.handle(c.id, { action: 'start' });
    const port = (started.ok && started.status.port) as number;
    const s = student(port, 11, c.id);
    await until(() => welcomed(s));
    await rooms.handle(c.id, { action: 'end_round' });
    await until(() => finished.length === 1);
    expect(finished[0]).toMatchObject({
      classId: c.id,
      result: { number: 1, standings: [{ rank: 1, accountId: 11, name: 'Student 11', banked: 0 }] },
    });
    await rooms.handle(c.id, { action: 'end_round' }); // already ended: nothing more
    await new Promise((r) => setTimeout(r, 300));
    expect(finished.length).toBe(1);
  }, 40000);

  it('the teacher can kick a student, and stop the room', async () => {
    const c = await make('K');
    const started = await rooms.handle(c.id, { action: 'start' });
    const port = (started.ok && started.status.port) as number;
    const s = student(port, 7, c.id);
    await until(() => welcomed(s));
    expect(await rooms.handle(c.id, { action: 'kick', accountId: 7 })).toMatchObject({ ok: true });
    expect(await s.closed).toMatchObject({ code: 4006 });
    await rooms.handle(c.id, { action: 'stop' });
    expect(rooms.status(c.id)).toEqual({ state: 'waiting' });
  }, 40000);
});
