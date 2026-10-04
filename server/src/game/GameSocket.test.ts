import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  Flag,
  PROTOCOL_VERSION,
  TEST_MAP,
  SnapshotDecoder,
  decodeServerMessages,
  encodeClientMessage,
  type ServerMessage,
} from '@heist/shared';
import { attachGameSocket, type GameSocket } from './GameSocket';
import { Match } from './Match';

let http: Server;
let socket: GameSocket;
let match: Match;
let url: string;
const clients: WebSocket[] = [];

beforeEach(async () => {
  http = createServer();
  match = new Match({ map: TEST_MAP, settings: DEFAULT_MATCH_SETTINGS });
  socket = attachGameSocket(http, match, { joinTimeoutMs: 200 });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  url = `ws://localhost:${(http.address() as AddressInfo).port}/ws/game`;
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  await socket.close();
  await new Promise((resolve) => http.close(resolve));
});

/** Connects and collects decoded server messages. */
async function connect() {
  const ws = new WebSocket(url);
  clients.push(ws);
  const messages: ServerMessage[] = [];
  const snapshotState = new SnapshotDecoder();
  const waiters: (() => void)[] = [];
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    messages.push(...decodeServerMessages(new Uint8Array(data), snapshotState));
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  const waitFor = async (predicate: (m: ServerMessage) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    throw new Error('timed out waiting for message');
  };
  const join = (name = 'Ana', protocol = PROTOCOL_VERSION) =>
    ws.send(encodeClientMessage({ t: 'join', protocol, name }));
  return { ws, messages, closed, waitFor, join };
}

describe('GameSocket', () => {
  it('welcomes a joining client and registers the player', async () => {
    const c = await connect();
    c.join('Ana');
    const welcome = await c.waitFor((m) => m.t === 'welcome');
    expect(welcome).toMatchObject({ t: 'welcome', mapId: 'sandbox' });
    expect(match.players.size).toBe(1);
  });

  it('two clients see each other, and a leave is announced', async () => {
    const a = await connect();
    a.join('Ana');
    await a.waitFor((m) => m.t === 'welcome');
    const b = await connect();
    b.join('Ben');
    await b.waitFor((m) => m.t === 'welcome');
    await a.waitFor((m) => m.t === 'event' && m.event.e === 'joined');
    match.step();
    const snap = await a.waitFor((m) => m.t === 'snapshot');
    expect(snap.t === 'snapshot' && snap.entities).toHaveLength(1);
    b.ws.close();
    await a.waitFor((m) => m.t === 'event' && m.event.e === 'left');
    expect(match.players.size).toBe(1);
  });

  it('answers ping with pong carrying the same client time', async () => {
    const c = await connect();
    c.join();
    await c.waitFor((m) => m.t === 'welcome');
    c.ws.send(encodeClientMessage({ t: 'ping', clientTime: 4242 }));
    const pong = await c.waitFor((m) => m.t === 'pong');
    expect(pong).toMatchObject({ clientTime: 4242 });
  });

  it('rejects a wrong protocol version with a close code', async () => {
    const c = await connect();
    c.join('Ana', PROTOCOL_VERSION + 1);
    expect(await c.closed).toBe(4000);
    expect(match.players.size).toBe(0);
  });

  it('drops clients that send garbage, text, or input before join', async () => {
    const garbage = await connect();
    garbage.ws.send(new Uint8Array([0x7f, 1, 2]));
    expect(await garbage.closed).toBe(1008);

    const text = await connect();
    text.ws.send('hello');
    expect(await text.closed).toBe(1008);

    const early = await connect();
    early.ws.send(
      encodeClientMessage({
        t: 'input',
        commands: [{ seq: 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, viewLagMs: 0 }],
      }),
    );
    expect(await early.closed).toBe(1008);
  });

  it('drops a client that never joins', async () => {
    const c = await connect();
    expect(await c.closed).toBe(1008);
  });

  it('queues input for the player', async () => {
    const c = await connect();
    c.join();
    await c.waitFor((m) => m.t === 'welcome');
    c.ws.send(
      encodeClientMessage({
        t: 'input',
        commands: [{ seq: 1, moveX: 127, moveY: 0, yaw: 0, pitch: 0, buttons: 0, viewLagMs: 0 }],
      }),
    );
    for (let i = 0; i < 50 && ![...match.players.values()][0]?.queue.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect([...match.players.values()][0]?.queue).toHaveLength(1);
  });

  it('plays a full kill cycle over real sockets: shoot, die, respawn', async () => {
    const a = await connect();
    a.join('Ana');
    await a.waitFor((m) => m.t === 'welcome');
    const b = await connect();
    b.join('Ben');
    await b.waitFor((m) => m.t === 'welcome');
    const [pa, pb] = [...match.players.values()];
    if (!pa || !pb) throw new Error('players missing');
    pa.body.x = 0;
    pa.body.z = 0;
    pa.protectedUntilTick = 0;
    pb.body.x = 0.55; // the bullet leaves 0.55 m to the right of the shooter (shoulder)
    pb.body.z = -10;
    pb.protectedUntilTick = 0;
    pb.hp = 20;

    a.ws.send(
      encodeClientMessage({
        t: 'input',
        commands: [
          { seq: 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: Button.Fire, viewLagMs: 0 },
        ],
      }),
    );
    for (let i = 0; i < 50 && pa.queue.length === 0 && pa.lastAppliedSeq === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    match.step();
    const kill = await b.waitFor((m) => m.t === 'event' && m.event.e === 'kill');
    expect(kill).toMatchObject({ event: { killer: pa.id, victim: pb.id } });
    const dead = await b.waitFor((m) => m.t === 'snapshot' && (m.self.flags & Flag.Alive) === 0);
    expect(dead.t === 'snapshot' && dead.self.hp).toBe(0);

    const delay = DEFAULT_COMBAT_SETTINGS.respawnDelaySec * DEFAULT_MATCH_SETTINGS.tickRate;
    for (let i = 0; i < delay; i++) match.step();
    expect(pb.alive).toBe(true);
    expect(pb.hp).toBe(DEFAULT_COMBAT_SETTINGS.respawnHp);
  });
});
