import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  TEST_MAP,
  weaponToWire,
  type InputCommand,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway, correctAnswer } from './testing';

function setup(map = HEIST_MAP) {
  const gateway = new ScriptedGateway();
  const match = new Match({
    map,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    challenges: gateway,
  });
  const join = (name: string, at = { x: 0, y: 0, z: 30 }) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    Object.assign(r.player.body, at);
    const send = (m: object) => match.receiveJson(r.player.id, JSON.stringify(m));
    const solve = async (rewardKey: string) => {
      gateway.answer = (raw) => correctAnswer(raw.ref, rewardKey);
      send({ t: 'challenge_submit', ref: 9, challengeId: 'c', sql: 'x' });
      await new Promise((resolve) => setImmediate(resolve));
    };
    const request = async (rewardKey: string) => {
      connection.clear();
      send({ t: 'challenge_request', ref: 1, rewardKey });
      await new Promise((resolve) => setImmediate(resolve));
      return connection.jsonOf('challenge')[0]?.result;
    };
    const lastSelf = () => connection.of('snapshot').at(-1)?.self;
    return { player: r.player, connection, send, solve, request, lastSelf };
  };
  return { match, join, gateway };
}

const fire = (seq: number): InputCommand => ({
  seq,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: Button.Fire,
  viewLagMs: 0,
});

/** Holds the trigger for `n` ticks (a full tick of input at 60 Hz = 3 commands); returns rounds the match fired. */
function pullTrigger(match: Match, id: number, ticks: number): void {
  let seq = 100;
  for (let t = 0; t < ticks; t++) {
    match.receiveInput(id, [fire(++seq), fire(++seq), fire(++seq)]);
    match.step();
  }
}

const shots = (c: FakeConnection) => c.of('event').filter((e) => e.event.e === 'shot').length;

describe('starting gear', () => {
  it('is empty hands on a heist map', () => {
    const { join } = setup();
    const a = join('A');
    expect(a.player.weaponId).toBe('');
    expect(a.player.arsenal.size).toBe(0);
  });

  it('is the endless sandbox rifle elsewhere', () => {
    const { join } = setup(TEST_MAP);
    const a = join('A');
    expect(a.player.weaponId).toBe('rifle');
    expect(a.player.infiniteAmmo).toBe(true);
  });

  it('cannot shoot while unarmed', () => {
    const { match, join } = setup();
    const a = join('A');
    pullTrigger(match, a.player.id, 10);
    expect(shots(a.connection)).toBe(0);
  });

  it('puts weapon and ammo in the snapshots', () => {
    const { match, join } = setup();
    const a = join('A');
    match.step();
    expect(a.lastSelf()).toMatchObject({ weapon: 0, ammo: 0 });
    match.heist.giveWeapon(a.player, 'smg');
    match.step();
    expect(a.lastSelf()).toMatchObject({ weapon: weaponToWire('smg'), ammo: 30 });
  });
});

describe('unlocking guns', () => {
  it('grants the gun with a full magazine and holds it', async () => {
    const { join } = setup();
    const a = join('A');
    await a.solve('gun:pistol');
    expect(a.player.weaponId).toBe('pistol');
    expect(a.player.ammo).toBe(12);
    expect(a.connection.jsonOf('arms').at(-1)).toEqual({
      t: 'arms',
      owned: ['pistol'],
      current: 'pistol',
    });
  });

  it('keeps earlier guns and switches to the newest', async () => {
    const { join } = setup();
    const a = join('A');
    await a.solve('gun:pistol');
    await a.solve('gun:rifle');
    expect([...a.player.arsenal.keys()]).toEqual(['pistol', 'rifle']);
    expect(a.player.weaponId).toBe('rifle');
  });

  it('refuses a gun you already hold, a dead player, and a gun that does not exist', async () => {
    const { join, gateway } = setup();
    const a = join('A');
    await a.solve('gun:pistol');
    gateway.calls.length = 0;
    expect(await a.request('gun:pistol')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await a.request('gun:laser')).toEqual({ ok: false, reason: 'unknown_reward' });
    a.player.alive = false;
    expect(await a.request('gun:sniper')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(gateway.calls).toHaveLength(0);
  });

  it('lets a player swap between owned guns, and only owned ones', async () => {
    const { join } = setup();
    const a = join('A');
    await a.solve('gun:pistol');
    await a.solve('gun:rifle');
    a.send({ t: 'equip', weapon: 'pistol' });
    expect(a.player.weaponId).toBe('pistol');
    expect(a.connection.jsonOf('arms').at(-1)?.current).toBe('pistol');
    a.send({ t: 'equip', weapon: 'sniper' });
    expect(a.player.weaponId).toBe('pistol');
  });

  it('takes the guns away on death, and a new life starts unarmed', async () => {
    const { match, join } = setup();
    const a = join('A');
    const b = join('B', { x: 40, y: 0, z: 40 });
    await a.solve('gun:rifle');
    match.damage(a.player, 500, b.player);
    for (let i = 0; i < 200 && !a.player.alive; i++) match.step();
    expect(a.player.alive).toBe(true);
    expect(a.player.weaponId).toBe('');
    expect(a.player.arsenal.size).toBe(0);
    expect(a.connection.jsonOf('arms').at(-1)).toEqual({ t: 'arms', owned: [], current: '' });
  });
});

describe('ammo', () => {
  it('runs out: a 12-round pistol fires 12 shots and then clicks', async () => {
    const { match, join } = setup();
    const a = join('A');
    await a.solve('gun:pistol');
    a.connection.clear();
    pullTrigger(match, a.player.id, 80); // plenty of time at 300 rpm
    expect(shots(a.connection)).toBe(12);
    expect(a.player.ammo).toBe(0);
  });

  it('a shotgun blast spends one round for all its pellets', async () => {
    const { match, join } = setup();
    const a = join('A');
    await a.solve('gun:shotgun');
    a.connection.clear();
    pullTrigger(match, a.player.id, 1);
    expect(a.player.ammo).toBe(5);
    expect(shots(a.connection)).toBe(8);
  });

  it('is refilled by an ammo task, only when the magazine is not full', async () => {
    const { match, join, gateway } = setup();
    const a = join('A');
    expect(await a.request('ammo:refill')).toEqual({ ok: false, reason: 'not_allowed' }); // unarmed
    await a.solve('gun:pistol');
    gateway.calls.length = 0;
    expect(await a.request('ammo:refill')).toEqual({ ok: false, reason: 'not_allowed' }); // full
    pullTrigger(match, a.player.id, 10);
    expect(a.player.ammo).toBeLessThan(12);
    await a.request('ammo:refill');
    expect(gateway.calls).toHaveLength(1);
    await a.solve('ammo:refill');
    expect(a.player.ammo).toBe(12);
  });

  it('never runs dry in the sandbox', () => {
    const { match, join } = setup(TEST_MAP);
    const a = join('A');
    a.connection.clear();
    pullTrigger(match, a.player.id, 100);
    expect(shots(a.connection)).toBeGreaterThan(25);
  });
});
