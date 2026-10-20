import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  streakBonus,
  type ChallengeServerMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway, correctAnswer } from './testing';

const S = DEFAULT_HEIST_SETTINGS;

describe('streakBonus', () => {
  it('pays nothing below the minimum, then grows by step up to the cap', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => streakBonus(n, S))).toEqual([
      0, 0, 500, 1000, 1500, 2000, 2500, 3000,
    ]);
  });

  it('is off when the step is 0', () => {
    expect(streakBonus(9, { ...S, streak: { ...S.streak, cashPerStep: 0 } })).toBe(0);
  });
});

function setup(taskOptions?: Match['heist']['taskOptions']) {
  const gateway = new ScriptedGateway();
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: S,
    challenges: gateway,
    ...(taskOptions ? { taskOptions } : {}),
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'A', connection);
  if (!r.ok) throw new Error('join failed');
  r.player.hp = 10;
  const answer = async (reply: ChallengeServerMessage) => {
    gateway.answer = () => reply;
    match.receiveJson(
      r.player.id,
      JSON.stringify({ t: 'challenge_submit', ref: 9, challengeId: 'c', sql: 'x' }),
    );
    await new Promise((resolve) => setImmediate(resolve));
  };
  const right = () => answer(correctAnswer(9, 'heal:small'));
  const wrong = () =>
    answer({
      t: 'challenge_result',
      ref: 9,
      now: 0,
      result: { status: 'wrong', feedback: 'no' } as never,
    });
  return { player: r.player, match, right, wrong, connection };
}

describe('streak bonus in play (26.4)', () => {
  it('pays from the third clean answer in a row, and says so', async () => {
    const s = setup();
    await s.right();
    await s.right();
    expect(s.player.cash).toBe(0);
    await s.right();
    expect(s.player.cash).toBe(500);
    await s.right();
    expect(s.player.cash).toBe(500 + 1000);
    expect(s.connection.jsonOf('notice').map((n) => (n as { text: string }).text)).toContain(
      'Streak ×4: +$1,000',
    );
  });

  it('a wrong submit ends the run', async () => {
    const s = setup();
    await s.right();
    await s.right();
    await s.wrong();
    await s.right();
    await s.right();
    expect(s.player.cash).toBe(0); // the run started again from one
    await s.right();
    expect(s.player.cash).toBe(500);
  });

  it('dying ends the run', async () => {
    const s = setup();
    await s.right();
    await s.right();
    s.match.heist.onDeath(s.player);
    await s.right();
    expect(s.player.cash).toBe(0);
  });

  it('pays nothing in the tutorial', async () => {
    const s = setup(() => ({}));
    for (let i = 0; i < 5; i++) await s.right();
    expect(s.player.cash).toBe(0);
  });
});
