import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { questionTemplateSchema, type ChallengeServerMessage } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { buildChallengeStack } from '../composition';
import { openDatabase } from '../db/database';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { attachChallengeSocket, type ChallengeSocket } from './ChallengeSocket';

let http: Server | undefined;
let socket: ChallengeSocket | undefined;
const open: WebSocket[] = [];

afterEach(async () => {
  for (const ws of open.splice(0)) ws.close();
  await socket?.close();
  await new Promise<void>((done) => (http ? http.close(() => done()) : done()));
  http = undefined;
});

async function start() {
  const db = openDatabase({ path: ':memory:' });
  new SqliteQuestionRepository(db).create(questionTemplateSchema.parse(sampleQuestion), null);
  const stack = buildChallengeStack(db, {
    sandbox: new InProcessSandboxRunner(),
    matchSeed: 'test',
  });
  http = createServer();
  socket = attachChallengeSocket(http, stack.handler, { maxPayload: 2_000 });
  await new Promise<void>((done) => http?.listen(0, done));
  return `ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws/challenge`;
}

function connect(url: string) {
  const ws = new WebSocket(url);
  open.push(ws);
  const inbox: ChallengeServerMessage[] = [];
  const waiters: ((m: ChallengeServerMessage) => void)[] = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data)) as ChallengeServerMessage;
    const w = waiters.shift();
    if (w) w(msg);
    else inbox.push(msg);
  });
  const ready = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
  return {
    ws,
    ready,
    send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    next: () =>
      new Promise<ChallengeServerMessage>((resolve) =>
        inbox.length ? resolve(inbox.shift() as ChallengeServerMessage) : waiters.push(resolve),
      ),
  };
}

describe('challenge socket', () => {
  it('issues, previews and grades over a real WebSocket', async () => {
    const c = connect(await start());
    await c.ready;
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'heal:small' });
    const issued = await c.next();
    if (issued.t !== 'challenge' || !issued.result.ok) throw new Error('no challenge');
    const id = issued.result.challenge.id;

    c.send({ t: 'challenge_run', ref: 2, challengeId: id, sql: 'SELECT name FROM employees' });
    expect(await c.next()).toMatchObject({ t: 'challenge_preview', ref: 2, result: { ok: true } });

    c.send({ t: 'challenge_submit', ref: 3, challengeId: id, sql: 'SELECT name FROM employees' });
    expect(await c.next()).toMatchObject({
      t: 'challenge_result',
      ref: 3,
      result: { status: 'wrong' },
    });
  });

  it('gives each connection its own player, so ids cannot be borrowed', async () => {
    const url = await start();
    const a = connect(url);
    const b = connect(url);
    await Promise.all([a.ready, b.ready]);
    a.send({ t: 'challenge_request', ref: 1, rewardKey: 'heal:small' });
    const issued = await a.next();
    if (issued.t !== 'challenge' || !issued.result.ok) throw new Error('no challenge');
    b.send({
      t: 'challenge_run',
      ref: 1,
      challengeId: issued.result.challenge.id,
      sql: 'SELECT 1',
    });
    expect(await b.next()).toMatchObject({ result: { ok: false, reason: 'not_found' } });
  });

  it('answers malformed JSON with a bad_message error and keeps the socket open', async () => {
    const c = connect(await start());
    await c.ready;
    c.send('{not json');
    expect(await c.next()).toMatchObject({ t: 'challenge_error', ref: null, code: 'bad_message' });
    c.send({ t: 'challenge_request', ref: 5, rewardKey: 'heal:small' });
    expect(await c.next()).toMatchObject({ t: 'challenge', ref: 5 });
  });

  it('drops connections that send oversized messages', async () => {
    const c = connect(await start());
    await c.ready;
    const closed = new Promise<void>((resolve) => c.ws.addEventListener('close', () => resolve()));
    c.send('x'.repeat(5_000));
    await closed;
  });
});
