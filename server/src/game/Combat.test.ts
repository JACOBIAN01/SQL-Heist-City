import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  Flag,
  PROTOCOL_VERSION,
  box,
  type CombatSettings,
  type GameEvent,
  type GameMap,
  type InputCommand,
} from '@heist/shared';
import { Match } from './Match';
import type { Player } from './Player';
import { FakeConnection } from './testing';

const open: GameMap = {
  id: 'arena',
  halfSize: 100,
  boxes: [],
  spawns: [{ x: 90, z: 90, yaw: 0 }],
};

/** Deterministic weapons: no spread, so a centred shot always lands where aimed. */
const exact: CombatSettings = {
  ...DEFAULT_COMBAT_SETTINGS,
  spawnProtectionSec: 0,
  weapons: {
    ...DEFAULT_COMBAT_SETTINGS.weapons,
    rifle: { damage: 28, rpm: 450, range: 80, magSize: 25, pellets: 1, spread: 0 },
    shotgun: { damage: 9, rpm: 70, range: 15, magSize: 6, pellets: 8, spread: 0.06 },
  },
};

function arena(map: GameMap = open, combat: CombatSettings = exact) {
  const match = new Match({ map, settings: DEFAULT_MATCH_SETTINGS, combat });
  const spawn = (name: string, x: number, z: number) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    r.player.body.x = x;
    r.player.body.z = z;
    return { player: r.player, connection };
  };
  return { match, spawn };
}

let seq = 0;
const fire = (over: Partial<InputCommand> = {}): InputCommand => ({
  seq: ++seq,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: Button.Fire,
  viewLagMs: 0,
  ...over,
});

const shots = (c: FakeConnection) =>
  c
    .of('event')
    .map((m) => m.event)
    .filter((e): e is Extract<GameEvent, { e: 'shot' }> => e.e === 'shot');
const kills = (c: FakeConnection) =>
  c
    .of('event')
    .map((m) => m.event)
    .filter((e): e is Extract<GameEvent, { e: 'kill' }> => e.e === 'kill');

/** Eye height of the shooter used to compute pitch for a given target height. */
const pitchTo = (distance: number, targetY: number) => Math.atan((targetY - 1.55) / distance);

describe('Combat: hitscan', () => {
  it('damages a target in the crosshair and tells everyone', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10); // the bullet leaves 0.55 m to A's right (shoulder offset)
    match.receiveInput(a.player.id, [fire({ yaw: 0 })]);
    match.step();
    expect(b.player.hp).toBe(exact.maxHp - 28);
    expect(shots(b.connection)[0]).toMatchObject({
      shooter: a.player.id,
      hit: 'body',
      target: b.player.id,
    });
  });

  it('headshots do double damage', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    match.receiveInput(a.player.id, [fire({ pitch: pitchTo(10, 1.7) })]);
    match.step();
    expect(b.player.hp).toBe(exact.maxHp - 56);
    expect(shots(a.connection)[0]?.hit).toBe('head');
  });

  it('misses when aimed away, and reports where the bullet ended', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 20, -10);
    match.receiveInput(a.player.id, [fire()]);
    match.step();
    expect(b.player.hp).toBe(exact.maxHp);
    const shot = shots(a.connection)[0];
    expect(shot).toMatchObject({ hit: 'miss', target: 0 });
    expect(shot?.endZ).toBeCloseTo(-80);
  });

  it('cannot shoot through walls', () => {
    const wall: GameMap = { ...open, boxes: [box('wall', 0, -5, 20, 4, 1)] };
    const { match, spawn } = arena(wall);
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    match.receiveInput(a.player.id, [fire()]);
    match.step();
    expect(b.player.hp).toBe(exact.maxHp);
  });

  it('cannot hit beyond weapon range', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -90);
    match.receiveInput(a.player.id, [fire()]);
    match.step();
    expect(b.player.hp).toBe(exact.maxHp);
  });

  it('never hits the shooter themselves', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    match.receiveInput(a.player.id, [fire({ pitch: -1.5 })]);
    match.step();
    expect(a.player.hp).toBe(exact.maxHp);
  });
});

describe('Combat: fire rate', () => {
  it('limits shots to the weapon rate, measured in simulated time', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    // 6 commands = 100 ms of input; rifle 450 rpm fires every 133 ms → only the first shot.
    match.receiveInput(
      a.player.id,
      Array.from({ length: 6 }, () => fire()),
    );
    match.step();
    expect(shots(a.connection)).toHaveLength(1);
    // 12 more commands (200 ms total ≥ 133 ms): a second shot appears.
    match.receiveInput(
      a.player.id,
      Array.from({ length: 6 }, () => fire()),
    );
    match.step();
    match.receiveInput(
      a.player.id,
      Array.from({ length: 6 }, () => fire()),
    );
    match.step();
    expect(shots(a.connection)).toHaveLength(3);
  });

  it('cannot fire faster by sending more commands per tick than the budget allows', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    match.receiveInput(
      a.player.id,
      Array.from({ length: 8 }, () => fire()),
    );
    match.receiveInput(
      a.player.id,
      Array.from({ length: 8 }, () => fire()),
    );
    match.step();
    expect(shots(a.connection).length).toBeLessThanOrEqual(1);
  });

  it('fires nothing without the fire button', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    match.receiveInput(a.player.id, [fire({ buttons: 0 })]);
    match.step();
    expect(shots(a.connection)).toHaveLength(0);
  });

  it('a shotgun fires every pellet as its own shot', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    a.player.weaponId = 'shotgun';
    match.receiveInput(a.player.id, [fire()]);
    match.step();
    expect(shots(a.connection)).toHaveLength(8);
  });

  it('is reproducible: the same seed gives the same spread', () => {
    const run = () => {
      const m = new Match({
        map: open,
        settings: DEFAULT_MATCH_SETTINGS,
        combat: exact,
        seed: 'fixed',
      });
      const c = new FakeConnection();
      const r = m.join(PROTOCOL_VERSION, 'A', c);
      if (!r.ok) throw new Error();
      r.player.weaponId = 'shotgun';
      m.receiveInput(r.player.id, [{ ...fire(), seq: 1 }]);
      m.step();
      return shots(c).map((s) => [s.endX, s.endZ]);
    };
    expect(run()).toEqual(run());
  });
});

describe('Combat: protection', () => {
  it('spawn protection absorbs hits until it expires', () => {
    const combat = { ...exact, spawnProtectionSec: 1 };
    const { match, spawn } = arena(open, combat);
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    const shootOnce = () => {
      a.player.cooldown = 0;
      match.receiveInput(a.player.id, [fire()]);
      match.step();
    };
    shootOnce();
    expect(b.player.hp).toBe(combat.maxHp);
    expect((b.connection.of('snapshot').at(-1)?.self.flags ?? 0) & Flag.Protected).toBeTruthy();
    for (let i = 0; i < 25; i++) match.step();
    shootOnce();
    expect(b.player.hp).toBe(combat.maxHp - 28);
    expect((b.connection.of('snapshot').at(-1)?.self.flags ?? 0) & Flag.Protected).toBeFalsy();
  });
});

describe('Combat: death and respawn', () => {
  const kill = (match: Match, a: { player: Player }, b: { player: Player }) => {
    b.player.hp = 10;
    a.player.cooldown = 0;
    match.receiveInput(a.player.id, [fire()]);
    match.step();
  };

  it('kills at zero hp, counts it and announces it', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    kill(match, a, b);
    expect(b.player.alive).toBe(false);
    expect(b.player.hp).toBe(0);
    expect(a.player.kills).toBe(1);
    expect(b.player.deaths).toBe(1);
    expect(kills(a.connection)[0]).toEqual({ e: 'kill', killer: a.player.id, victim: b.player.id });
    expect((b.connection.of('snapshot').at(-1)?.self.flags ?? 0) & Flag.Alive).toBe(0);
  });

  it('a dead player cannot be hit again or shoot', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    kill(match, a, b);
    a.connection.clear();
    a.player.cooldown = 0;
    match.receiveInput(a.player.id, [fire()]);
    b.player.body.x = 0; // would line up with B's own shot too
    match.receiveInput(b.player.id, [fire({ yaw: Math.PI })]);
    match.step();
    expect(a.player.kills).toBe(1);
    expect(shots(a.connection).every((s) => s.shooter !== b.player.id)).toBe(true);
  });

  it('respawns after the delay with reset health, protection and a new spot', () => {
    const { match, spawn } = arena(open, { ...exact, spawnProtectionSec: 2 });
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    b.player.protectedUntilTick = 0; // fresh joiners are protected; this test is about what follows a death
    kill(match, a, b);
    const delayTicks = exact.respawnDelaySec * DEFAULT_MATCH_SETTINGS.tickRate;
    for (let i = 0; i < delayTicks - 2; i++) match.step();
    expect(b.player.alive).toBe(false);
    for (let i = 0; i < 3; i++) match.step();
    expect(b.player.alive).toBe(true);
    expect(b.player.hp).toBe(exact.respawnHp);
    expect(b.player.body.x).toBe(90);
    const flags = b.connection.of('snapshot').at(-1)?.self.flags ?? 0;
    expect(flags & Flag.Alive).toBeTruthy();
    expect(flags & Flag.Protected).toBeTruthy();
    expect(b.player.protectedUntilTick).toBeGreaterThan(match.tick);
  });

  it('a respawned player moves again', () => {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    kill(match, a, b);
    for (let i = 0; i < exact.respawnDelaySec * DEFAULT_MATCH_SETTINGS.tickRate + 1; i++)
      match.step();
    const z = b.player.body.z;
    match.receiveInput(b.player.id, [{ ...fire(), buttons: 0, moveY: 127 }]);
    match.step();
    expect(b.player.body.z).toBeLessThan(z);
  });
});

describe('Combat: lag compensation', () => {
  /** The target runs sideways at 10 m/s (0.5 m per tick). `fireAt` is where the shooter aims. */
  function chase(viewLagMs: number, ticksBack: number) {
    const { match, spawn } = arena();
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0, -10);
    const x = (tick: number) => tick * 0.5;
    const history = 12;
    for (let tick = 1; tick <= history; tick++) {
      b.player.body.x = x(tick);
      match.step();
    }
    // Next step is tick 13. The target is now at x(13); the shooter's screen showed x(13 − ticksBack).
    b.player.body.x = x(13);
    a.player.body.x = x(13 - ticksBack) - 0.55; // aim origin = body.x + 0.55
    match.receiveInput(a.player.id, [fire({ viewLagMs })]);
    match.step();
    return { hp: b.player.hp };
  }

  it('hits where the target was on the shooter’s screen', () => {
    // 100 ms = 2 ticks back
    expect(chase(100, 2).hp).toBe(exact.maxHp - 28);
  });

  it('misses without compensation: aiming at where the target was, with no lag declared', () => {
    expect(chase(0, 2).hp).toBe(exact.maxHp);
  });

  it('blends between ticks for lags that are not a whole number of ticks', () => {
    // 125 ms = 2.5 ticks back
    expect(chase(125, 2.5).hp).toBe(exact.maxHp - 28);
  });

  it('caps the rewind, so claiming a huge lag does not reach back further than the limit', () => {
    // 200 ms = 4 ticks is allowed...
    expect(chase(200, 4).hp).toBe(exact.maxHp - 28);
    // ...but a client claiming 1 s of lag still only rewinds 4 ticks: aiming 8 ticks back misses.
    expect(chase(1000, 8).hp).toBe(exact.maxHp);
  });

  it('forgets the past on respawn instead of blending the old spot into the spawn point', () => {
    const { match, spawn } = arena(open, { ...exact, respawnDelaySec: 0.1 });
    const a = spawn('A', 0, 0);
    const b = spawn('B', 0.55, -10);
    b.player.protectedUntilTick = 0;
    for (let i = 0; i < 4; i++) match.step();
    b.player.hp = 1;
    match.receiveInput(a.player.id, [fire()]);
    match.step(); // B dies this tick
    const lastOldTick = match.tick - 1;
    while (!b.player.alive) match.step();
    const respawnTick = match.tick;
    b.player.protectedUntilTick = 0;

    // Shoot at the point 1/3 of the way along the (bogus) old-spot → spawn line.
    const rewind = respawnTick + 1 - 3; // 150 ms = 3 ticks back from the next step
    const t = (rewind - lastOldTick) / (respawnTick - lastOldTick);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    const aimX = 0.55 + (90 - 0.55) * t;
    const aimZ = -10 + (90 + 10) * t;
    a.player.body.x = aimX - 0.55;
    a.player.body.z = aimZ + 10;
    a.player.cooldown = 0;
    match.receiveInput(a.player.id, [fire({ viewLagMs: 150 })]);
    match.step();
    expect(b.player.hp).toBe(exact.respawnHp);
  });
});
