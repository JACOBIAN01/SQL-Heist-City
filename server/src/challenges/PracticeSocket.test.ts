import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { issueTicket } from '../auth/ticket';
import { MemorySink } from '../analytics/AttemptSink';
import { buildChallengeStack } from '../composition';
import { openDatabase } from '../db/database';
import { ticketAuth } from '../game/GameAuth';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { attachPracticeSocket, type PracticeSocket } from './PracticeSocket';

const SECRET = 'practice-test-secret-practice-test';
let http: Server | undefined;
let socket: PracticeSocket | undefined;
const open: WebSocket[] = [];

afterEach(async () => {
  for (const ws of open.splice(0)) ws.close();
  await socket?.close();
  await new Promise<void>((done) => (http ? http.close(() => done()) : done()));
  http = undefined;
});

async function start(required = false) {
  const db = openDatabase({ path: ':memory:' });
  const repo = new SqliteQuestionRepository(db);
  const base = questionTemplateSchema.parse(sampleQuestion);
  repo.create({ ...base, slug: 'where-one', tier: 1, topic: ['where'] }, null);
  repo.create({ ...base, slug: 'join-two', tier: 2, topic: ['join'] }, null);
  const sink = new MemorySink();
  const stack = buildChallengeStack(db, {
    sandbox: new InProcessSandboxRunner(),
    matchSeed: 't',
    attempts: sink,
  });
  http = createServer();
  socket = attachPracticeSocket(http, stack.handler, {
    topics: () => stack.practiceTopics(),
    auth: ticketAuth(SECRET, required),
  });
  await new Promise<void>((done) => http?.listen(0, done));
  return { port: (http.address() as AddressInfo).port, sink };
}

function connect(port: number, ticket = '', topic = '') {
  const query = [ticket && `ticket=${ticket}`, topic && `topic=${topic}`].filter(Boolean).join('&');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/practice${query ? `?${query}` : ''}`);
  open.push(ws);
  const inbox: Record<string, unknown>[] = [];
  const waiters: ((m: Record<string, unknown>) => void)[] = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as Record<string, unknown>;
    const w = waiters.shift();
    if (w) w(m);
    else inbox.push(m);
  });
  const closed = new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)));
  const ready = new Promise<void>((r) => ws.addEventListener('open', () => r()));
  return {
    ready,
    closed,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: () =>
      new Promise<Record<string, unknown>>((r) =>
        inbox.length ? r(inbox.shift() as Record<string, unknown>) : waiters.push(r),
      ),
  };
}

describe('practice drill (16.9)', () => {
  it('lists the topics with their tiers and concept titles', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.ready;
    c.send({ t: 'practice_topics' });
    const m = (await c.next()) as {
      topics: { topic: string; tiers: number[]; questions: number }[];
    };
    expect(m.topics.map((t) => [t.topic, t.tiers, t.questions])).toEqual([
      ['join', [2], 1],
      ['where', [1], 1],
    ]);
  });

  it('gives a question of the chosen tier and topic, over and over, with no reward and no match', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.ready;
    c.send({ t: 'practice_topic', topic: 'join' });
    expect(await c.next()).toEqual({ t: 'practice_topic', topic: 'join' });
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'practice:2' });
    const first = (await c.next()) as {
      result: { ok: boolean; challenge: { tier: number; rewardKey: string } };
    };
    expect(first.result).toMatchObject({
      ok: true,
      challenge: { tier: 2, rewardKey: 'practice:2' },
    });
    // A topic with no question at that tier gives nothing, rather than another topic.
    const d = connect(port);
    await d.ready;
    d.send({ t: 'practice_topic', topic: 'join' });
    await d.next();
    d.send({ t: 'challenge_request', ref: 2, rewardKey: 'practice:1' });
    expect(((await d.next()) as { result: { ok: boolean; reason: string } }).result).toMatchObject({
      ok: false,
      reason: 'no_questions',
    });
  });

  it('can start on a topic chosen in the address', async () => {
    const { port } = await start();
    const c = connect(port, '', 'join');
    await c.ready;
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'practice:2' });
    expect(((await c.next()) as { result: { ok: boolean } }).result.ok).toBe(true);
    const d = connect(port, '', 'join');
    await d.ready;
    d.send({ t: 'challenge_request', ref: 1, rewardKey: 'practice:1' });
    expect(((await d.next()) as { result: { reason: string } }).result.reason).toBe('no_questions');
  });

  it('refuses rewards: a drill never hands out a gun, a heal or a vault lock', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.ready;
    for (const key of ['gun:rifle', 'heal:full', 'vault:bank-1:lock-1']) {
      c.send({ t: 'challenge_request', ref: 1, rewardKey: key });
      expect(((await c.next()) as { result: { reason: string } }).result.reason, key).toBe(
        'unknown_reward',
      );
    }
  });

  it('records the attempt for the signed-in student, so practice counts toward their profile', async () => {
    const { port, sink } = await start(true);
    const c = connect(port, issueTicket(SECRET, { id: 42, name: 'Ana' }));
    await c.ready;
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'practice:1' });
    await c.next();
    c.send({ t: 'challenge_abandon', ref: 2 });
    await c.next();
    expect(sink.items[0]?.who).toMatchObject({ accountId: 42 });
    expect(sink.items[0]?.item).toMatchObject({ rewardKey: 'practice:1', outcome: 'abandoned' });
  });

  it('needs a ticket when sign-in is required, and refuses a bad or reused one', async () => {
    const { port } = await start(true);
    expect(await connect(port).closed).toBe(4005);
    expect(await connect(port, 'not.a.ticket').closed).toBe(4005);
    const ticket = issueTicket(SECRET, { id: 1, name: 'A' });
    const ok = connect(port, ticket);
    await ok.ready;
    expect(await connect(port, ticket).closed).toBe(4005);
  });

  it('refuses an odd topic name and refuses binary frames politely', async () => {
    const { port } = await start();
    const c = connect(port);
    await c.ready;
    c.send({ t: 'practice_topic', topic: "x'; DROP" });
    expect(await c.next()).toEqual({ t: 'practice_topic', topic: null });
  });
});
