import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway, correctAnswer } from './testing';

function setup(hp = 40) {
  const gateway = new ScriptedGateway();
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, healByTier: { small: 20, medium: 50, full: 1000 } },
    challenges: gateway,
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'A', connection);
  if (!r.ok) throw new Error('join failed');
  r.player.hp = hp;
  const send = (m: object) => match.receiveJson(r.player.id, JSON.stringify(m));
  const solve = async (tier: string) => {
    gateway.answer = (raw) => correctAnswer(raw.ref, `heal:${tier}`);
    send({ t: 'challenge_submit', ref: 9, challengeId: 'c', sql: 'x' });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const request = async (tier: string) => {
    connection.clear();
    send({ t: 'challenge_request', ref: 1, rewardKey: `heal:${tier}` });
    await new Promise((resolve) => setImmediate(resolve));
    return connection.jsonOf('challenge')[0]?.result;
  };
  return { player: r.player, gateway, solve, request };
}

describe('heal tasks', () => {
  it('restores the configured amount for the tier', async () => {
    const s = setup(40);
    await s.solve('small');
    expect(s.player.hp).toBe(60);
    await s.solve('medium');
    expect(s.player.hp).toBe(100); // 60 + 50, capped at max HP
  });

  it('a full heal brings you to max HP', async () => {
    const s = setup(5);
    await s.solve('full');
    expect(s.player.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp);
  });

  it('is refused at full health, without spending a question', async () => {
    const s = setup(100);
    expect(await s.request('small')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(s.gateway.calls).toHaveLength(0);
  });

  it('is refused for a dead player', async () => {
    const s = setup(0);
    s.player.alive = false;
    expect(await s.request('small')).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('is refused for a tier the settings do not define', async () => {
    const s = setup(40);
    expect(await s.request('mega')).toEqual({ ok: false, reason: 'unknown_reward' });
  });

  it('lets a request through when the player is hurt', async () => {
    const s = setup(40);
    await s.request('small');
    expect(s.gateway.calls).toHaveLength(1);
  });

  it('does not resurrect a player who died while solving', async () => {
    const s = setup(40);
    s.player.alive = false;
    s.player.hp = 0;
    await s.solve('full');
    expect(s.player.hp).toBe(0);
  });

  it('follows retuned amounts', async () => {
    const gateway = new ScriptedGateway();
    const match = new Match({
      map: HEIST_MAP,
      settings: DEFAULT_MATCH_SETTINGS,
      heist: { ...DEFAULT_HEIST_SETTINGS, healByTier: { small: 7 } },
      challenges: gateway,
    });
    const r = match.join(PROTOCOL_VERSION, 'A', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    r.player.hp = 10;
    gateway.answer = (raw) => correctAnswer(raw.ref, 'heal:small');
    match.receiveJson(
      r.player.id,
      JSON.stringify({ t: 'challenge_submit', ref: 1, challengeId: 'c', sql: 'x' }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.player.hp).toBe(17);
  });
});
