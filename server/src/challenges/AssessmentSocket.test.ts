import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { MemorySink } from '../analytics/AttemptSink';
import { issueTicket } from '../auth/ticket';
import { InMemoryAssessmentStore } from '../classes/AssessmentStore';
import { buildChallengeStack } from '../composition';
import { openDatabase } from '../db/database';
import { ticketAuth } from '../game/GameAuth';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { attachAssessmentSocket, type AssessmentSocket } from './AssessmentSocket';

const SECRET = 'assess-test-secret-assess-test-secret';
let http: Server | undefined;
let socket: AssessmentSocket | undefined;
const open: WebSocket[] = [];

afterEach(async () => {
  for (const ws of open.splice(0)) ws.close();
  await socket?.close();
  await new Promise<void>((done) => (http ? http.close(() => done()) : done()));
  http = undefined;
});

async function start(isOpen = true) {
  const db = openDatabase({ path: ':memory:' });
  const repo = new SqliteQuestionRepository(db);
  const base = questionTemplateSchema.parse(sampleQuestion);
  const q1 = repo.create({ ...base, slug: 'q-one', tier: 1 }, null);
  const q2 = repo.create({ ...base, slug: 'q-two', tier: 4 }, null);
  const sink = new MemorySink();
  const stack = buildChallengeStack(db, {
    sandbox: new InProcessSandboxRunner(),
    matchSeed: 't',
    attempts: sink,
  });
  const assessments = new InMemoryAssessmentStore();
  await assessments.save(7, 'pre', [q1.id, q2.id], isOpen);
  const answered = new Set<number>();
  http = createServer();
  socket = attachAssessmentSocket(http, stack.handler, {
    assessments,
    slugOf: (id) => stack.slugOf(id),
    answered: async () => new Set(answered),
    auth: ticketAuth(SECRET, true),
  });
  await new Promise<void>((done) => http?.listen(0, '127.0.0.1', done));
  return { port: (http.address() as AddressInfo).port, sink, answered, q1: q1.id, q2: q2.id };
}

function connect(port: number, query: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/assess?${query}`);
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
  return {
    closed,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: () =>
      new Promise<Record<string, unknown>>((r) =>
        inbox.length ? r(inbox.shift() as Record<string, unknown>) : waiters.push(r),
      ),
  };
}
const ticketFor = (account: number, classId = 7) =>
  encodeURIComponent(issueTicket(SECRET, { id: account, name: 'S', classId }));

describe('pre/post assessment (16.10)', () => {
  it("gives the same fixed questions in order, with no hints, recorded as the class's pre assessment", async () => {
    const { port, sink } = await start();
    const c = connect(port, `class=7&kind=pre&ticket=${ticketFor(1)}`);
    expect(await c.next()).toMatchObject({ t: 'assess_ready', kind: 'pre', total: 2 });
    c.send({ t: 'assess_plan' });
    expect(await c.next()).toMatchObject({ t: 'assess_plan', total: 2, done: [false, false] });
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'assess:1' });
    const issued = (await c.next()) as {
      result: { ok: boolean; challenge: { tier: number; hintCosts: number[]; id: string } };
    };
    expect(issued.result).toMatchObject({ ok: true, challenge: { tier: 4, hintCosts: [] } });
    c.send({ t: 'challenge_hint', ref: 2, challengeId: issued.result.challenge.id, index: 0 });
    expect(((await c.next()) as { result: { ok: boolean } }).result.ok).toBe(false);
    c.send({ t: 'challenge_abandon', ref: 3 });
    await c.next();
    expect(sink.items[0]?.who).toMatchObject({ accountId: 1, classId: 7, assessment: 'pre' });
    expect(sink.items[0]?.item).toMatchObject({ assessment: 'pre', tier: 4 });
  });

  it('allows one go at each question', async () => {
    const { port, answered, q1 } = await start();
    answered.add(q1);
    const c = connect(port, `class=7&kind=pre&ticket=${ticketFor(1)}`);
    await c.next();
    c.send({ t: 'assess_plan' });
    expect(await c.next()).toMatchObject({ done: [true, false] });
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'assess:0' });
    expect(((await c.next()) as { result: { reason: string } }).result.reason).toBe('not_allowed');
  });

  it('refuses a student of another class, an unknown kind, and a closed assessment', async () => {
    const { port } = await start();
    expect(await connect(port, `class=7&kind=pre&ticket=${ticketFor(1, 8)}`).closed).toBe(4005);
    expect(await connect(port, `class=7&kind=mid&ticket=${ticketFor(2)}`).closed).toBe(4005);
    expect(await connect(port, `class=7&kind=post&ticket=${ticketFor(3)}`).closed).toBe(4007); // none exists
    await socket?.close();
    await new Promise<void>((done) => (http ? http.close(() => done()) : done()));
    const closed = await start(false);
    expect(await connect(closed.port, `class=7&kind=pre&ticket=${ticketFor(4)}`).closed).toBe(4007);
  });

  it('refuses a question number out of range', async () => {
    const { port } = await start();
    const c = connect(port, `class=7&kind=pre&ticket=${ticketFor(1)}`);
    await c.next();
    c.send({ t: 'challenge_request', ref: 1, rewardKey: 'assess:9' });
    expect(((await c.next()) as { result: { reason: string } }).result.reason).toBe(
      'unknown_reward',
    );
  });
});
