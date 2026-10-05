import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
} from '@heist/shared';
import { Match } from '../game/Match';
import type { Player } from '../game/Player';
import { FakeConnection } from '../game/testing';
import { HeistEvents } from './HeistEvents';
import { RoundAwards } from './RoundAwards';
import { ScriptedGateway, correctAnswer } from './testing';

const player = (id: number, name: string) => ({ id, name }) as Player;

function setup() {
  const events = new HeistEvents();
  const awards = new RoundAwards(events);
  const ana = player(1, 'Ana');
  const ben = player(2, 'Ben');
  const here = new Map([
    [1, ana],
    [2, ben],
  ]);
  const results = () => awards.results((id) => here.get(id));
  return { events, awards, ana, ben, here, results };
}

describe('RoundAwards', () => {
  it('gives nothing when nothing happened', () => {
    expect(setup().results()).toEqual([]);
  });

  it('counts kills, locks and solved tasks, and keeps the best single banking', () => {
    const { events, ana, ben, results } = setup();
    events.publish({ type: 'kill', killer: ana, victim: ben });
    events.publish({ type: 'kill', killer: ana, victim: ben });
    events.publish({ type: 'kill', killer: ben, victim: ana });
    events.publish({ type: 'banked', player: ben, amount: 30_000 });
    events.publish({ type: 'banked', player: ben, amount: 5_000 });
    events.publish({ type: 'banked', player: ana, amount: 20_000 });
    events.publish({ type: 'task_solved', player: ana, rewardKey: 'heal:small' });
    const byId = new Map(results().map((a) => [a.id, a]));
    expect(byId.get('top_gun')).toEqual({ id: 'top_gun', playerId: 1, name: 'Ana', value: 2 });
    expect(byId.get('big_haul')).toMatchObject({ playerId: 2, value: 30_000 });
    expect(byId.get('sql_brain')).toMatchObject({ playerId: 1, value: 1 });
    expect(byId.has('safecracker')).toBe(false);
  });

  it('gives the quickest answer to the lowest time', () => {
    const { events, ana, ben, results } = setup();
    events.publish({ type: 'task_solved', player: ana, rewardKey: 'gun:pistol', seconds: 41.23 });
    events.publish({ type: 'task_solved', player: ben, rewardKey: 'heal:small', seconds: 18.04 });
    events.publish({ type: 'task_solved', player: ben, rewardKey: 'heal:small', seconds: 60 });
    expect(results().find((a) => a.id === 'quick_draw')).toMatchObject({
      playerId: 2,
      value: 18,
    });
  });

  it('breaks a tie in favour of whoever got there first', () => {
    const { events, ana, ben, results } = setup();
    events.publish({ type: 'kill', killer: ben, victim: ana });
    events.publish({ type: 'kill', killer: ana, victim: ben });
    expect(results().find((a) => a.id === 'top_gun')?.name).toBe('Ben');
  });

  it('passes over players who left, and forgets everything at a new round', () => {
    const { events, awards, ana, ben, here, results } = setup();
    events.publish({ type: 'kill', killer: ana, victim: ben });
    events.publish({ type: 'kill', killer: ana, victim: ben });
    events.publish({ type: 'kill', killer: ben, victim: ana });
    here.delete(1);
    expect(results().find((a) => a.id === 'top_gun')?.name).toBe('Ben');
    awards.reset();
    expect(results()).toEqual([]);
  });
});

describe('awards in a match', () => {
  const quick = {
    ...DEFAULT_HEIST_SETTINGS,
    locksPerVault: 1,
    roundMinutes: 0.2,
    intermissionSeconds: 2,
  };

  function match() {
    const gateway = new ScriptedGateway();
    const m = new Match({
      map: HEIST_MAP,
      settings: DEFAULT_MATCH_SETTINGS,
      combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
      heist: quick,
      challenges: gateway,
    });
    const join = (name: string) => {
      const connection = new FakeConnection();
      const r = m.join(PROTOCOL_VERSION, name, connection);
      if (!r.ok) throw new Error('join failed');
      r.player.protectedUntilTick = 0;
      return { player: r.player, connection };
    };
    return { m, gateway, join };
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('times an answer from the question being issued, and credits the lock to its solver', async () => {
    const { m, gateway, join } = match();
    const a = join('Ana');
    const vault = HEIST_MAP.vaults?.[0];
    const console_ = HEIST_MAP.anchors?.find((x) => x.id === vault?.consoleId);
    if (!vault || !console_) throw new Error('no vault');
    m.teleport(a.player, console_.x, console_.y, console_.z);
    const send = (msg: object) => m.receiveJson(a.player.id, JSON.stringify(msg));
    const rewardKey = 'vault:bank-1:lock-1';
    gateway.answer = (raw) => ({
      t: 'challenge',
      ref: raw.ref,
      now: 10_000,
      result: {
        ok: true,
        challenge: { id: 'c' } as never,
      },
    });
    send({ t: 'challenge_request', ref: 1, rewardKey, target: vault.id });
    await settle();
    gateway.answer = (raw) => ({ ...correctAnswer(raw.ref, rewardKey, vault.id), now: 34_500 });
    send({ t: 'challenge_submit', ref: 2, challengeId: 'c', sql: 'x' });
    await settle();
    const awards = m.heist.awards.results((id) => m.getPlayer(id));
    expect(awards.find((x) => x.id === 'quick_draw')).toMatchObject({ name: 'Ana', value: 24.5 });
    expect(awards.find((x) => x.id === 'safecracker')).toMatchObject({ name: 'Ana', value: 1 });
  });

  it('shows the awards with the final standings, and clears them for the next round', () => {
    const { m, join } = match();
    const a = join('Ana');
    const b = join('Ben');
    m.damage(b.player, 500, a.player);
    for (let i = 0; i < 0.2 * 60 * 20 + 2; i++) m.step();
    const ended = a.connection.jsonOf('round').find((r) => r.phase === 'ended');
    expect(ended?.phase === 'ended' && ended.awards).toEqual([
      { id: 'top_gun', playerId: a.player.id, name: 'Ana', value: 1 },
    ]);
    for (let i = 0; i < 2 * 20 + 2; i++) m.step();
    expect(m.heist.awards.results((id) => m.getPlayer(id))).toEqual([]);
  });
});
