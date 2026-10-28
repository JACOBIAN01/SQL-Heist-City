import { describe, expect, it, vi } from 'vitest';
import type { ChallengeClientMessage, CheatMessage, PublicChallenge } from '@heist/shared';
import { ChallengeProtocolError } from './ChallengeApi';
import { ChannelChallengeApi } from './ChannelChallengeApi';

const challenge = { id: 'c1' } as PublicChallenge;

function setup() {
  const sent: (ChallengeClientMessage | CheatMessage)[] = [];
  let clock = 1_000;
  const api = new ChannelChallengeApi({ send: (m) => sent.push(m) }, () => clock, 5_000);
  return { api, sent, setClock: (t: number) => (clock = t) };
}

describe('ChannelChallengeApi', () => {
  it('sends ref-tagged requests and resolves with the matching reply', async () => {
    const { api, sent } = setup();
    const pending = api.request('vault:bank-1:lock-1', 'bank-1');
    expect(sent).toEqual([
      { t: 'challenge_request', ref: 1, rewardKey: 'vault:bank-1:lock-1', target: 'bank-1' },
    ]);
    expect(
      api.handle({ t: 'challenge', ref: 1, now: 9_000, result: { ok: true, challenge } }),
    ).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true, challenge });
  });

  it('syncs its clock to the server from reply timestamps', async () => {
    const { api } = setup();
    const pending = api.abandon();
    api.handle({ t: 'challenge_abandoned', ref: 1, now: 5_000 });
    await pending;
    expect(api.serverNow()).toBe(5_000);
  });

  it('turns a server error into a protocol error', async () => {
    const { api } = setup();
    const pending = api.run('c1', 'SELECT 1');
    api.handle({ t: 'challenge_error', ref: 1, now: 1, code: 'bad_message', message: 'nope' });
    await expect(pending).rejects.toBeInstanceOf(ChallengeProtocolError);
  });

  it('ignores messages that are not challenge replies', () => {
    const { api } = setup();
    expect(
      api.handle({
        t: 'interact_result',
        ref: 1,
        anchor: 'a',
        result: { action: 'moved', storey: 1 },
      }),
    ).toBe(false);
  });

  it('fails waiting requests when closed', async () => {
    vi.useFakeTimers();
    const { api } = setup();
    const pending = api.submit('c1', 'SELECT 1');
    const failed = expect(pending).rejects.toThrow(/closed/);
    api.close();
    await failed;
    vi.useRealTimers();
  });

  it('sends the cheat code and resolves with what the server decided (37.4)', async () => {
    const { api, sent } = setup();
    const pending = api.cheat('c1', 'abc-def');
    expect(sent).toEqual([{ t: 'cheat', ref: 1, challengeId: 'c1', code: 'abc-def' }]);
    api.handle({
      t: 'challenge_cheat',
      ref: 1,
      now: 9_000,
      result: { ok: true, rewardKey: 'heal:small', target: null },
    });
    await expect(pending).resolves.toEqual({ ok: true, rewardKey: 'heal:small', target: null });
  });
});
