import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicChallenge } from '@heist/shared';
import { FakeSocket } from '../testing/FakeSocket';
import { ChallengeConnectionError, ChallengeProtocolError } from './ChallengeApi';
import { WebSocketChallengeApi } from './WebSocketChallengeApi';

let sockets: FakeSocket[];
let api: WebSocketChallengeApi;
let clock: number;

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  clock = 1_000;
  api = new WebSocketChallengeApi('ws://game/ws/challenge', {
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    timeoutMs: 5_000,
    now: () => clock,
  });
});
afterEach(() => vi.useRealTimers());

const challenge = { id: 'c1' } as PublicChallenge;
const last = () => sockets[sockets.length - 1] as FakeSocket;

/** Opens the (lazily created) socket and lets the request go out. */
async function opened() {
  await vi.advanceTimersByTimeAsync(0);
  last().open();
  await vi.advanceTimersByTimeAsync(0);
}

describe('WebSocketChallengeApi', () => {
  it('connects on first use, sends a ref-tagged request and resolves with the matching reply', async () => {
    const pending = api.request('heal:small', 'self');
    await opened();
    expect(last().url).toBe('ws://game/ws/challenge');
    expect(last().sent).toEqual([
      { t: 'challenge_request', ref: 1, rewardKey: 'heal:small', target: 'self' },
    ]);
    last().reply({ t: 'challenge', ref: 1, now: 5_000, result: { ok: true, challenge } });
    await expect(pending).resolves.toEqual({ ok: true, challenge });
  });

  it('matches replies by ref even when they arrive out of order', async () => {
    const run = api.run('c1', 'SELECT 1');
    await opened();
    const submit = api.submit('c1', 'SELECT 2');
    await vi.advanceTimersByTimeAsync(0);
    last().reply({
      t: 'challenge_result',
      ref: 2,
      now: 1,
      result: { status: 'locked', lockedUntil: 9 },
    });
    last().reply({
      t: 'challenge_preview',
      ref: 1,
      now: 1,
      result: { ok: true, preview: { columns: [], rows: [], truncated: false } },
    });
    await expect(submit).resolves.toEqual({ status: 'locked', lockedUntil: 9 });
    await expect(run).resolves.toMatchObject({ ok: true });
  });

  it('reuses one socket for several requests', async () => {
    const a = api.request('heal:small');
    await opened();
    last().reply({ t: 'challenge', ref: 1, now: 1, result: { ok: false, reason: 'no_questions' } });
    await a;
    const b = api.request('heal:small');
    await vi.advanceTimersByTimeAsync(0);
    last().reply({ t: 'challenge', ref: 2, now: 1, result: { ok: false, reason: 'no_questions' } });
    await b;
    expect(sockets).toHaveLength(1);
  });

  it('tracks the server clock from reply timestamps', async () => {
    const pending = api.abandon();
    await opened();
    last().reply({ t: 'challenge_abandoned', ref: 1, now: 11_000 });
    await pending;
    clock += 500;
    expect(api.serverNow()).toBe(11_500);
  });

  it('rejects with a connection error when the socket cannot open', async () => {
    const pending = api.request('heal:small');
    const assertion = expect(pending).rejects.toBeInstanceOf(ChallengeConnectionError);
    await vi.advanceTimersByTimeAsync(0);
    last().fail();
    await assertion;
  });

  it('rejects in-flight requests when the connection drops', async () => {
    const pending = api.run('c1', 'SELECT 1');
    await opened();
    const assertion = expect(pending).rejects.toBeInstanceOf(ChallengeConnectionError);
    last().close();
    await assertion;
  });

  it('times out when the server never answers', async () => {
    const pending = api.run('c1', 'SELECT 1');
    await opened();
    const assertion = expect(pending).rejects.toThrow(/did not answer in time/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('turns server error messages and wrong reply types into protocol errors', async () => {
    const a = api.run('c1', 'SELECT 1');
    await opened();
    const aAssert = expect(a).rejects.toBeInstanceOf(ChallengeProtocolError);
    last().reply({ t: 'challenge_error', ref: 1, now: 1, code: 'bad_message', message: 'nope' });
    await aAssert;
    const b = api.run('c1', 'SELECT 1');
    await vi.advanceTimersByTimeAsync(0);
    const bAssert = expect(b).rejects.toThrow(/unexpected reply/);
    last().reply({ t: 'challenge', ref: 2, now: 1, result: { ok: false, reason: 'no_questions' } });
    await bAssert;
  });

  it('ignores junk and unknown refs', async () => {
    const pending = api.request('heal:small');
    await opened();
    last().reply('not even json');
    last().reply({ t: 'other', ref: 1 });
    last().reply({
      t: 'challenge',
      ref: 99,
      now: 1,
      result: { ok: false, reason: 'no_questions' },
    });
    last().reply({ t: 'challenge', ref: 1, now: 1, result: { ok: false, reason: 'no_questions' } });
    await expect(pending).resolves.toMatchObject({ ok: false });
  });

  it('reconnects after a drop on the next call', async () => {
    const first = api.run('c1', 'SELECT 1');
    await opened();
    const firstAssertion = expect(first).rejects.toBeInstanceOf(ChallengeConnectionError);
    last().close();
    await firstAssertion;
    const second = api.request('heal:small');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
    last().open();
    await vi.advanceTimersByTimeAsync(0);
    last().reply({ t: 'challenge', ref: 2, now: 1, result: { ok: false, reason: 'no_questions' } });
    await expect(second).resolves.toMatchObject({ ok: false });
  });
});
