import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  Flag,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type InputCommand,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

function setup(over: { spawnProtectionSec?: number } = {}) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 5, ...over },
  });
  const join = (name: string, at = { x: 0, y: 0, z: 30 }) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    Object.assign(r.player.body, at);
    r.player.protectedUntilTick = 0;
    return { player: r.player, connection };
  };
  const wait = (seconds: number) => {
    for (let i = 0; i < seconds * 20; i++) match.step();
  };
  return { match, join, wait };
}

describe('death and the hospital', () => {
  it('brings the dead back at the hospital after the delay, with half health, unarmed and protected', () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B', { x: 30, y: 0, z: 30 });
    match.heist.giveWeapon(a.player, 'rifle');
    match.damage(a.player, 500, b.player);
    expect(a.player.alive).toBe(false);
    wait(4);
    expect(a.player.alive).toBe(false); // 5 s delay
    wait(1.5);
    expect(a.player.alive).toBe(true);
    expect(a.player.hp).toBe(DEFAULT_COMBAT_SETTINGS.respawnHp);
    expect(a.player.weaponId).toBe('');
    expect(a.player.body.z).toBeLessThan(-50); // the hospital is north of the lot
    expect(a.player.body.y).toBe(0);
    const spots = HEIST_MAP.respawns ?? [];
    expect(spots.some((s) => Math.abs(s.x - a.player.body.x) < 0.01)).toBe(true);
    expect((a.connection.of('snapshot').at(-1)?.self.flags ?? 0) & Flag.Protected).toBeTruthy();
  });

  it('keeps banked cash and vault progress through death', () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B', { x: 30, y: 0, z: 30 });
    a.player.banked = 40_000;
    match.heist.openLock('bank-1:vault', 1);
    match.damage(a.player, 500, b.player);
    wait(6);
    expect(a.player.banked).toBe(40_000);
    expect(match.heist.vaults.get('bank-1:vault')?.locksOpen).toBe(1);
  });

  it('spreads simultaneous respawns over the hospital beds', () => {
    const { match, join, wait } = setup();
    const k = join('Killer', { x: 30, y: 0, z: 30 });
    const dead = [0, 1, 2].map((i) => join(`D${i}`, { x: i, y: 0, z: 20 }));
    for (const d of dead) match.damage(d.player, 500, k.player);
    wait(6);
    const xs = new Set(dead.map((d) => d.player.body.x));
    expect(xs.size).toBeGreaterThan(1);
  });
});

describe('kill bonus', () => {
  it('pays the killer, on top of the victim’s drop', () => {
    const { match, join } = setup();
    const a = join('A');
    const b = join('B', { x: 30, y: 0, z: 30 });
    match.damage(a.player, 500, b.player);
    expect(b.player.cash).toBe(DEFAULT_HEIST_SETTINGS.killBonus);
    expect(a.player.cash).toBe(0);
  });

  it('is configurable, and can be off', () => {
    const match = new Match({
      map: HEIST_MAP,
      settings: DEFAULT_MATCH_SETTINGS,
      heist: { ...DEFAULT_HEIST_SETTINGS, killBonus: 0 },
    });
    const ca = new FakeConnection();
    const cb = new FakeConnection();
    const a = match.join(PROTOCOL_VERSION, 'A', ca);
    const b = match.join(PROTOCOL_VERSION, 'B', cb);
    if (!a.ok || !b.ok) throw new Error('join failed');
    a.player.protectedUntilTick = 0;
    match.damage(a.player, 500, b.player);
    expect(b.player.cash).toBe(0);
  });
});

describe('spawn protection', () => {
  const fire = (seq: number): InputCommand => ({
    seq,
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    buttons: Button.Fire,
    viewLagMs: 0,
  });

  it('protects a new joiner from damage', () => {
    const { match } = setup();
    const connection = new FakeConnection();
    const a = match.join(PROTOCOL_VERSION, 'A', connection);
    const b = match.join(PROTOCOL_VERSION, 'B', new FakeConnection());
    if (!a.ok || !b.ok) throw new Error('join failed');
    match.damage(a.player, 50, b.player);
    expect(a.player.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp);
  });

  it('ends the moment the protected player fires', () => {
    const { match, join } = setup();
    const a = join('A');
    match.heist.giveWeapon(a.player, 'pistol');
    a.player.protectedUntilTick = match.tick + 1000;
    match.receiveInput(a.player.id, [fire(1)]);
    match.step();
    expect(a.player.protectedUntilTick).toBe(0);
  });

  it('does not end when the player is unarmed and merely pulls the trigger', () => {
    const { match, join } = setup();
    const a = join('A');
    a.player.protectedUntilTick = match.tick + 1000;
    match.receiveInput(a.player.id, [fire(1)]);
    match.step();
    expect(a.player.protectedUntilTick).toBeGreaterThan(0);
  });
});

describe('hospital layout', () => {
  it('has beds clear of walls and inside the lot', () => {
    for (const s of HEIST_MAP.respawns ?? []) {
      expect(Math.abs(s.x)).toBeLessThan(HEIST_MAP.halfSize);
      expect(Math.abs(s.z)).toBeLessThan(HEIST_MAP.halfSize);
      expect(
        HEIST_MAP.boxes.some(
          (b) =>
            s.x + 0.5 > b.minX &&
            s.x - 0.5 < b.maxX &&
            s.z + 0.5 > b.minZ &&
            s.z - 0.5 < b.maxZ &&
            b.minY < 2,
        ),
      ).toBe(false);
    }
  });
});
