import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  weaponSpecSchema,
  type CombatSettings,
  type GameMap,
  type InputCommand,
} from '@heist/shared';
import { AnomalyLog, type Anomaly } from './AnomalyLog';
import { Match } from './Match';
import { FakeConnection } from './testing';

const open: GameMap = { id: 'arena', halfSize: 100, boxes: [], spawns: [{ x: 90, z: 90, yaw: 0 }] };
const exact: CombatSettings = {
  ...DEFAULT_COMBAT_SETTINGS,
  spawnProtectionSec: 0,
  weapons: {
    ...DEFAULT_COMBAT_SETTINGS.weapons,
    rifle: weaponSpecSchema.parse({ damage: 28, rpm: 450, range: 80, magSize: 25, spread: 0 }),
  },
};

function arena() {
  const logged: Anomaly[] = [];
  const anomalies = new AnomalyLog((a) => logged.push(a));
  const match = new Match({
    map: open,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: exact,
    anomalies,
  });
  const spawn = (name: string, x: number, z: number) => {
    const r = match.join(PROTOCOL_VERSION, name, new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    r.player.body.x = x;
    r.player.body.z = z;
    return r.player;
  };
  return { match, spawn, logged, anomalies };
}

let seq = 0;
const cmd = (over: Partial<InputCommand> = {}): InputCommand => ({
  seq: ++seq,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  viewLagMs: 0,
  ...over,
});
const kinds = (logged: Anomaly[]) => [...new Set(logged.map((a) => a.kind))];

describe('anti-cheat (18.3)', () => {
  it('a speed hack (far more input than real time) moves no faster, and is logged', () => {
    const { match, spawn, logged } = arena();
    const a = spawn('A', 0, 0);
    const before = a.body.z;
    for (let t = 0; t < 20; t++) {
      match.receiveInput(
        a.id,
        Array.from({ length: 60 }, () => cmd({ moveY: 127, buttons: Button.Sprint })),
      );
      match.step();
    }
    // Each tick applies at most maxCommandsPerTick commands of 1/60 s: 60 a tick buy nothing more.
    const most = 20 * DEFAULT_MATCH_SETTINGS.maxCommandsPerTick * (1 / 60) * 6.8;
    expect(Math.abs(a.body.z - before)).toBeLessThanOrEqual(most * 1.02);
    expect(kinds(logged)).toContain('input_flood');
    expect(kinds(logged)).not.toContain('speed');
  });

  it('flags movement past the speed envelope (a physics bug being used)', () => {
    const { match, spawn, logged } = arena();
    const a = spawn('A', 0, 0);
    a.body.vz = -300; // what a launch bug would do
    match.receiveInput(
      a.id,
      [1, 2, 3].map(() => cmd({ moveY: 127, buttons: Button.Sprint })),
    );
    match.step();
    expect(kinds(logged)).toContain('speed');
  });

  it('caps a claimed lag, and logs the claim', () => {
    const { match, spawn, logged } = arena();
    const a = spawn('A', 0, 0);
    match.receiveInput(a.id, [cmd({ viewLagMs: 1000 })]);
    expect(logged[0]).toMatchObject({ kind: 'lag_claim', player: a.key });
  });

  it('audits fire rate per gun and flags shots past it', () => {
    const { match, spawn, logged } = arena();
    const a = spawn('A', 0, 0);
    match.heist.giveWeapon(a, 'rifle');
    for (let t = 0; t < 20; t++) {
      a.cooldown = 0; // what a bug skipping the cooldown would do
      match.receiveInput(a.id, [cmd({ buttons: Button.Fire })]);
      match.step();
      a.cooldown = 0;
    }
    expect(kinds(logged)).toContain('fire_rate');
  });

  it('honest firing never trips the audit', () => {
    const { match, spawn, logged } = arena();
    const a = spawn('A', 0, 0);
    match.heist.giveWeapon(a, 'rifle');
    for (let t = 0; t < 40; t++) {
      match.receiveInput(
        a.id,
        [1, 2, 3].map(() => cmd({ buttons: Button.Fire })),
      );
      match.step();
    }
    expect(logged).toEqual([]);
  });

  it('logs impossible actions and malformed messages', () => {
    const { match, spawn, logged } = arena();
    const a = spawn('A', 0, 0);
    match.receiveJson(a.id, JSON.stringify({ t: 'interact', ref: 1, anchor: 'nowhere' }));
    match.receiveJson(
      a.id,
      JSON.stringify({ t: 'challenge_request', ref: 2, rewardKey: 'god:mode' }),
    );
    match.receiveJson(a.id, JSON.stringify({ t: 'interact', anchor: 42 }));
    expect(logged.map((l) => l.kind)).toEqual([
      'impossible_action',
      'impossible_action',
      'malformed',
    ]);
  });
});

describe('AnomalyLog', () => {
  it('counts everything but writes only a few lines per player and kind, and names suspects', () => {
    const lines: Anomaly[] = [];
    const log = new AnomalyLog((a) => lines.push(a), 2);
    for (let i = 0; i < 12; i++) log.record({ at: i, tick: i, player: 'p1', kind: 'input_flood' });
    log.record({ at: 0, tick: 0, player: 'p2', kind: 'malformed' });
    expect(lines).toHaveLength(3);
    expect(log.counts()).toEqual({ input_flood: 12, malformed: 1 });
    expect(log.of('p1')).toEqual({ input_flood: 12 });
    expect(log.suspects(10)).toEqual([{ player: 'p1', total: 12 }]);
    log.forget('p1');
    expect(log.suspects(1)).toEqual([{ player: 'p2', total: 1 }]);
  });
});
