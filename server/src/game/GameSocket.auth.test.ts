import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  TEST_MAP,
  decodeServerMessages,
  encodeClientMessage,
} from '@heist/shared';
import { issueTicket } from '../auth/ticket';
import { ticketAuth } from './GameAuth';
import { attachGameSocket, type GameSocket } from './GameSocket';
import { Match } from './Match';

const SECRET = 'socket-test-secret-socket-test';
let http: Server;
let socket: GameSocket;
const open: WebSocket[] = [];

async function boot(required: boolean) {
  http = createServer();
  const match = new Match({ map: TEST_MAP, settings: DEFAULT_MATCH_SETTINGS });
  socket = attachGameSocket(http, match, {
    joinTimeoutMs: 500,
    auth: ticketAuth(SECRET, required),
  });
  await new Promise<void>((r) => http.listen(0, r));
  const url = `ws://localhost:${(http.address() as AddressInfo).port}/ws/game`;
  return { match, url };
}

/** Joins with a name and ticket; resolves to what happened: the welcome, or the close code and reason. */
function joinWith(url: string, name: string, ticket: string) {
  const ws = new WebSocket(url);
  open.push(ws);
  return new Promise<{ welcomed: boolean; code?: number; reason?: string }>((resolve) => {
    let welcomed = false;
    ws.on('open', () =>
      ws.send(encodeClientMessage({ t: 'join', protocol: PROTOCOL_VERSION, name, ticket })),
    );
    ws.on('message', (data: Buffer) => {
      if (decodeServerMessages(new Uint8Array(data)).some((m) => m.t === 'welcome')) {
        welcomed = true;
        resolve({ welcomed });
      }
    });
    ws.on('close', (code, reason) => resolve({ welcomed, code, reason: reason.toString() }));
  });
}

afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  await socket.close();
  await new Promise((r) => http.close(r));
});

describe('joining with a ticket', () => {
  it('takes the name and account from the ticket, not from what the client typed', async () => {
    const { match, url } = await boot(true);
    const result = await joinWith(
      url,
      'Hacker',
      issueTicket(SECRET, { id: 42, name: 'Ana Silva' }),
    );
    expect(result.welcomed).toBe(true);
    const [player] = [...match.players.values()];
    expect(player).toMatchObject({ name: 'Ana Silva', accountId: 42 });
  });

  it('refuses a join with no ticket when sign-in is required', async () => {
    const { match, url } = await boot(true);
    expect(await joinWith(url, 'Anon', '')).toMatchObject({ welcomed: false, code: 4005 });
    expect(match.players.size).toBe(0);
  });

  it('lets an unsigned join in when sign-in is not required (development, bots)', async () => {
    const { match, url } = await boot(false);
    expect((await joinWith(url, 'Bot 1', '')).welcomed).toBe(true);
    expect([...match.players.values()][0]).toMatchObject({ name: 'Bot 1', accountId: undefined });
  });

  it('refuses a forged, wrong-secret, expired or reused ticket, even when sign-in is optional', async () => {
    const { match, url } = await boot(false);
    const player = { id: 1, name: 'Ana' };
    expect(
      (await joinWith(url, 'x', issueTicket('another-secret-another-secret', player))).code,
    ).toBe(4005);
    expect((await joinWith(url, 'x', issueTicket(SECRET, player, Date.now() - 120_000))).code).toBe(
      4005,
    );
    expect((await joinWith(url, 'x', 'not.a.ticket')).code).toBe(4005);
    const good = issueTicket(SECRET, player);
    expect((await joinWith(url, 'x', good)).welcomed).toBe(true);
    expect((await joinWith(url, 'x', good)).code).toBe(4005); // a ticket works once
    expect(match.players.size).toBe(1);
  });

  it('keeps one account to one player per match', async () => {
    const { match, url } = await boot(true);
    const player = { id: 9, name: 'Ana' };
    expect((await joinWith(url, 'x', issueTicket(SECRET, player))).welcomed).toBe(true);
    expect(await joinWith(url, 'x', issueTicket(SECRET, player))).toMatchObject({ code: 4004 });
    expect(match.players.size).toBe(1);
  });
});
