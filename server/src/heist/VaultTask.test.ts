import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type ChallengeServerMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import type { ChallengeGateway } from './ChallengeGateway';
import { ScriptedGateway } from './testing';

const correct = (ref: number, lock: number): ChallengeServerMessage => ({
  t: 'challenge_result',
  ref,
  now: 0,
  result: { status: 'correct', rewardKey: `vault:bank-1:lock-${lock}`, target: 'bank-1:vault' },
});

function setup(gateway: ChallengeGateway | null = new ScriptedGateway(), locks = 3) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, locksPerVault: locks },
    ...(gateway ? { challenges: gateway } : {}),
  });
  const join = (name: string) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    Object.assign(r.player.body, { x: 2.4, y: 6, z: -5.3 }); // at the vault console
    const send = (m: object) => match.receiveJson(r.player.id, JSON.stringify(m));
    return { player: r.player, connection, send };
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { match, join, settle, gateway };
}

const request = (ref = 1, over: object = {}) => ({
  t: 'challenge_request',
  ref,
  rewardKey: 'vault:bank-1:lock-1',
  target: 'bank-1:vault',
  ...over,
});

describe('vault lock tasks', () => {
  it('passes an allowed request to the challenge system and returns its reply', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    a.send(request());
    await settle();
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]?.player).toBe(a.player.key);
    expect(a.connection.jsonOf('challenge_abandoned')).toHaveLength(1);
  });

  it('refuses without asking the challenge system when the player is away from the console', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    a.player.body.x = -20;
    a.send(request());
    await settle();
    expect(g.calls).toHaveLength(0);
    expect(a.connection.jsonOf('challenge')[0]).toMatchObject({
      ref: 1,
      result: { ok: false, reason: 'not_allowed' },
    });
  });

  it('refuses on the wrong storey', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    a.player.body.y = 3;
    a.send(request());
    await settle();
    expect(a.connection.jsonOf('challenge')[0]?.result).toMatchObject({ reason: 'not_allowed' });
  });

  it('refuses a lock that is not the next one, or a vault that does not exist', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    a.send(request(1, { rewardKey: 'vault:bank-1:lock-2' }));
    a.send(request(2, { target: 'nowhere' }));
    a.send(request(3, { target: undefined }));
    await settle();
    expect(g.calls).toHaveLength(0);
    expect(a.connection.jsonOf('challenge').map((m) => m.result)).toEqual([
      { ok: false, reason: 'not_allowed' },
      { ok: false, reason: 'not_allowed' },
      { ok: false, reason: 'not_allowed' },
    ]);
  });

  it('refuses a dead player', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    a.player.alive = false;
    a.send(request());
    await settle();
    expect(g.calls).toHaveLength(0);
  });

  it('refuses reward keys no rule owns', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    a.send(request(1, { rewardKey: 'gun:laser', target: undefined }));
    await settle();
    expect(g.calls).toHaveLength(0);
    expect(a.connection.jsonOf('challenge')[0]?.result).toEqual({
      ok: false,
      reason: 'unknown_reward',
    });
  });

  it('opens the lock when the answer is correct, and tells everyone', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    const b = join('B');
    g.answer = (raw) => correct(raw.ref, 1);
    b.connection.clear();
    a.send({ t: 'challenge_submit', ref: 5, challengeId: 'c1', sql: 'SELECT 1' });
    await settle();
    expect(a.connection.jsonOf('challenge_result')[0]).toMatchObject({
      ref: 5,
      result: { status: 'correct' },
    });
    expect(b.connection.jsonOf('vaults').at(-1)?.vaults[0]?.opened).toBe(1);
  });

  it('opens the vault door after the last lock', async () => {
    const g = new ScriptedGateway();
    const { join, settle, match } = setup(g, 1);
    const a = join('A');
    g.answer = (raw) => correct(raw.ref, 1);
    a.send({ t: 'challenge_submit', ref: 1, challengeId: 'c1', sql: 'x' });
    await settle();
    expect(match.heist.openLock('bank-1:vault', 1)).toBe(false); // already open
    expect(a.connection.jsonOf('vaults').at(-1)?.vaults[0]).toMatchObject({ opened: 1, locks: 1 });
  });

  it('tells a slower solver that the lock was already opened', async () => {
    const g = new ScriptedGateway();
    const { join, settle, match } = setup(g);
    const a = join('A');
    match.heist.openLock('bank-1:vault', 1); // somebody else got there first
    g.answer = (raw) => correct(raw.ref, 1);
    a.send({ t: 'challenge_submit', ref: 1, challengeId: 'c1', sql: 'x' });
    await settle();
    expect(a.connection.jsonOf('notice')[0]?.text).toMatch(/first/);
  });

  it('does not reward a wrong answer', async () => {
    const g = new ScriptedGateway();
    const { join, settle } = setup(g);
    const a = join('A');
    g.answer = (raw) => ({
      t: 'challenge_result',
      ref: raw.ref,
      now: 0,
      result: { status: 'locked', lockedUntil: 1 },
    });
    a.connection.clear();
    a.send({ t: 'challenge_submit', ref: 1, challengeId: 'c1', sql: 'x' });
    await settle();
    expect(a.connection.jsonOf('vaults')).toHaveLength(0);
  });

  it('forgets a player who leaves, and drops answers that arrive after', async () => {
    const g = new ScriptedGateway();
    const { join, settle, match } = setup(g);
    const a = join('A');
    a.send({ t: 'challenge_submit', ref: 1, challengeId: 'c1', sql: 'x' });
    match.leave(a.player.id);
    await settle();
    expect(g.left).toEqual([a.player.key]);
    expect(a.connection.jsonOf('challenge_abandoned')).toHaveLength(0);
  });

  it('answers "unavailable" when no challenge system is attached', async () => {
    const { join, settle } = setup(null);
    const a = join('A');
    a.send(request());
    await settle();
    expect(a.connection.jsonOf('challenge')[0]?.result).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('gives each join its own key even when a player id is reused', () => {
    const { join, match } = setup();
    const a = join('A');
    const first = a.player.key;
    match.leave(a.player.id);
    const b = join('B');
    expect(b.player.key).not.toBe(first);
  });
});
