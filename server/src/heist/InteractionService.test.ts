import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

function setup(at = { x: 9.5, y: 0, z: 5 }) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
  });
  const connection = new FakeConnection();
  const joined = match.join(PROTOCOL_VERSION, 'A', connection);
  if (!joined.ok) throw new Error('join failed');
  const player = joined.player;
  Object.assign(player.body, at);
  let ref = 0;
  const use = (anchor: string) => {
    connection.clear();
    match.receiveJson(player.id, JSON.stringify({ t: 'interact', ref: ++ref, anchor }));
    return connection.json().find((m) => m.t === 'interact_result') as
      { ref: number; result: { action: string; reason?: string; storey?: number } } | undefined;
  };
  const wait = (ticks: number) => {
    for (let i = 0; i < ticks; i++) match.step();
  };
  return { match, player, connection, use, wait };
}

describe('lifts', () => {
  it('ride up one storey at a time and back to the ground from the top', () => {
    const { player, use, wait } = setup();
    expect(use('bank-1:lift:0')?.result).toEqual({ action: 'moved', storey: 1 });
    expect(player.body.y).toBe(3);
    wait(20);
    expect(use('bank-1:lift:1')?.result).toEqual({ action: 'moved', storey: 2 });
    expect(player.body.y).toBe(6);
    wait(20);
    expect(use('bank-1:lift:2')?.result).toEqual({ action: 'moved', storey: 0 });
    expect(player.body.y).toBe(0);
  });

  it('echoes the request ref so the client can match the answer', () => {
    const { use } = setup();
    expect(use('bank-1:lift:0')?.ref).toBe(1);
  });

  it('clears velocity so a fall is not carried through the floor', () => {
    const { player, use } = setup();
    player.body.vy = -20;
    use('bank-1:lift:0');
    expect(player.body.vy).toBe(0);
  });
});

describe('validation', () => {
  it('refuses an anchor that does not exist', () => {
    expect(setup().use('nowhere')?.result).toEqual({ action: 'denied', reason: 'unknown_anchor' });
  });

  it('refuses from too far away, even one storey off', () => {
    expect(setup({ x: 0, y: 0, z: 5 }).use('bank-1:lift:0')?.result).toEqual({
      action: 'denied',
      reason: 'too_far',
    });
    expect(setup({ x: 9.5, y: 3, z: 5 }).use('bank-1:lift:0')?.result).toEqual({
      action: 'denied',
      reason: 'too_far',
    });
  });

  it('refuses a dead player', () => {
    const s = setup();
    s.player.alive = false;
    expect(s.use('bank-1:lift:0')?.result).toEqual({ action: 'denied', reason: 'dead' });
  });

  it('refuses a second use before the cooldown ends', () => {
    const s = setup();
    s.use('bank-1:lift:0');
    s.player.body.y = 0; // pretend the player is back on the ground floor pad
    expect(s.use('bank-1:lift:0')?.result).toEqual({ action: 'denied', reason: 'cooldown' });
    s.wait(20);
    expect(s.use('bank-1:lift:0')?.result.action).toBe('moved');
  });

  it('ignores malformed JSON and unknown messages without answering', () => {
    const s = setup();
    s.connection.clear();
    s.match.receiveJson(s.player.id, '{not json');
    s.match.receiveJson(s.player.id, JSON.stringify({ t: 'interact', anchor: 5 }));
    s.match.receiveJson(s.player.id, JSON.stringify({ t: 'fly_to_moon' }));
    expect(s.connection.json()).toEqual([]);
  });
});
