import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type InputCommand,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

function setup(locks = 3) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, locksPerVault: locks },
  });
  const connection = new FakeConnection();
  const joined = match.join(PROTOCOL_VERSION, 'A', connection);
  if (!joined.ok) throw new Error('join failed');
  const player = joined.player;
  // The top-storey console, beside the vault door.
  Object.assign(player.body, { x: 2.4, y: 6, z: -5.3 });
  let ref = 0;
  const useConsole = () => {
    connection.clear();
    match.receiveJson(
      player.id,
      JSON.stringify({ t: 'interact', ref: ++ref, anchor: 'bank-1:vault:console' }),
    );
    for (let i = 0; i < 20; i++) match.step(); // clear the use cooldown
    return connection.jsonOf('interact_result')[0];
  };
  const walkEast = (ticks: number) => {
    const command = (seq: number): InputCommand => ({
      seq,
      moveX: 0,
      moveY: 127,
      yaw: -Math.PI / 2,
      pitch: 0,
      buttons: 0,
      viewLagMs: 0,
    });
    for (let i = 0; i < ticks; i++) {
      match.receiveInput(player.id, [command(i * 3 + 1), command(i * 3 + 2), command(i * 3 + 3)]);
      match.step();
    }
  };
  return { match, player, connection, useConsole, walkEast };
}

describe('vault console', () => {
  it('offers the first lock of the bank, tiered by the bank', () => {
    expect(setup().useConsole()?.result).toEqual({
      action: 'open_task',
      rewardKey: 'vault:bank-1:lock-1',
      target: 'bank-1:vault',
    });
  });

  it('offers the next lock after one is opened, for anyone', () => {
    const s = setup();
    s.match.heist.openLock('bank-1:vault', 1);
    expect(s.useConsole()?.result).toMatchObject({ rewardKey: 'vault:bank-1:lock-2' });
  });

  it('refuses once the vault is open', () => {
    const s = setup(1);
    s.match.heist.openLock('bank-1:vault', 1);
    expect(s.useConsole()?.result).toEqual({ action: 'denied', reason: 'not_available' });
  });
});

describe('vault state', () => {
  it('tells a joining player where the vaults stand', () => {
    const s = setup();
    expect(s.connection.jsonOf('vaults')[0]?.vaults).toEqual([
      { id: 'bank-1:vault', tier: 1, locks: 3, opened: 0 },
    ]);
  });

  it('tells everyone when a lock opens', () => {
    const s = setup();
    s.connection.clear();
    s.match.heist.openLock('bank-1:vault', 1);
    expect(s.connection.jsonOf('vaults')[0]?.vaults[0]?.opened).toBe(1);
  });

  it('ignores a lock that is not next, or that is already open', () => {
    const s = setup();
    expect(s.match.heist.openLock('bank-1:vault', 2)).toBe(false);
    expect(s.match.heist.openLock('bank-1:vault', 1)).toBe(true);
    expect(s.match.heist.openLock('bank-1:vault', 1)).toBe(false);
    expect(s.match.heist.openLock('nowhere', 1)).toBe(false);
  });

  it('blocks the doorway until the last lock opens', () => {
    const closed = setup(1);
    closed.walkEast(30);
    expect(closed.player.body.x).toBeLessThan(3.8);

    const opened = setup(1);
    opened.match.heist.openLock('bank-1:vault', 1);
    opened.walkEast(30);
    expect(opened.player.body.x).toBeGreaterThan(6);
  });

  it('keeps a partly opened vault shut', () => {
    const s = setup(3);
    s.match.heist.openLock('bank-1:vault', 1);
    s.walkEast(30);
    expect(s.player.body.x).toBeLessThan(3.8);
  });
});
