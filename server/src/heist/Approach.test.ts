import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  findAnchor,
  mapById,
  raycastMap,
  type GameMap,
  type HeistSettings,
  type MapAnchor,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const vault = city.vaults?.[0];
if (!vault) throw new Error('no vault');
const found = findAnchor(city, vault.consoleId);
if (!found) throw new Error('no console');
const console1: MapAnchor = found;
const A = DEFAULT_HEIST_SETTINGS.approach;

/** A clear spot `d` m from the console on its floor. */
function spotAt(d: number): { x: number; z: number } {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (
      raycastMap(
        city,
        console1.x,
        console1.y + 1.5,
        console1.z,
        Math.cos(a),
        0,
        Math.sin(a),
        d + 0.5,
      ) === undefined
    )
      return { x: console1.x + Math.cos(a) * d, z: console1.z + Math.sin(a) * d };
  }
  throw new Error('no clear line');
}

function setup(guards: boolean, approach: Partial<HeistSettings['approach']> = {}) {
  const heist: HeistSettings = {
    ...DEFAULT_HEIST_SETTINGS,
    approach: { ...DEFAULT_HEIST_SETTINGS.approach, ...approach },
    // Keep chips and caches out of the sums.
    caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
    collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
    guards: { ...DEFAULT_HEIST_SETTINGS.guards, ...(guards ? {} : { perBankTier: {} }) },
  };
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 30, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist,
    seed: 'approach-test',
  });
  const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const spot = spotAt(10);
  match.teleport(player, spot.x, console1.y, spot.z);
  // Past the round countdown and the guards' first placement.
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  // The guards may have shot a player standing in their room; put them back, whole.
  player.alive = true;
  player.hp = match.maxHp;
  match.teleport(player, spot.x, console1.y, spot.z);
  return { match, player, heist: match.heist };
}

describe('approach: stealth or loud (30.7)', () => {
  it('slows a player who goes quiet, and gives the speed back when they stop', () => {
    const { player, heist } = setup(false);
    heist.setApproach(player, 'stealth');
    expect(player.speedScale).toBeCloseTo(A.stealthSpeed);
    heist.setApproach(player, 'loud');
    expect(player.speedScale).toBe(1);
  });

  it('crack a lock quietly when unseen: no alarm, no stars, no bonus, a quiet vault', () => {
    const { player, heist } = setup(false);
    heist.setApproach(player, 'stealth');
    heist.openLock(vault.id, 1, player);
    expect(heist.police.starsOf(player)).toBe(0);
    expect(player.cash).toBe(0);
    expect(heist.vaults.get(vault.id)?.view().quiet).toBe(true);
  });

  it('crack a lock loudly by default: stars, the alarm and the loud bonus', () => {
    const { player, heist } = setup(false);
    heist.openLock(vault.id, 1, player);
    expect(heist.police.starsOf(player)).toBe(1);
    expect(player.cash).toBe(A.loudBonus);
    expect(heist.vaults.get(vault.id)?.view().quiet).toBeUndefined();
  });

  it('turn a stealth lock loud when a guard can see the player', () => {
    const { match, player, heist } = setup(true);
    // Stand six metres from the guard at the console, on a line nothing blocks.
    const guard = heist.guards
      .all()
      .find((g) => Math.hypot(g.body.x - console1.x, g.body.z - console1.z) < 6);
    if (!guard) throw new Error('no guard at the console');
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const clear =
        raycastMap(
          city,
          guard.body.x,
          guard.body.y + 1.5,
          guard.body.z,
          Math.cos(a),
          -0.1,
          Math.sin(a),
          6.5,
        ) === undefined;
      if (!clear) continue;
      match.teleport(
        player,
        guard.body.x + Math.cos(a) * 6,
        guard.body.y,
        guard.body.z + Math.sin(a) * 6,
      );
      break;
    }
    expect(heist.guards.canSee(player)).toBe(true);
    heist.setApproach(player, 'stealth');
    heist.openLock(vault.id, 1, player);
    expect(heist.police.starsOf(player)).toBe(1);
    expect(player.cash).toBe(A.loudBonus);
  });

  it('pay a ghost vault more than a loud one', () => {
    const quiet = setup(false);
    quiet.heist.setApproach(quiet.player, 'stealth');
    const loud = setup(false);
    const total = (s: ReturnType<typeof setup>, asStealth: boolean) => {
      if (asStealth) s.heist.setApproach(s.player, 'stealth');
      const v = s.heist.vaults.get(vault.id);
      for (let k = 1; k <= (v?.lockCount ?? 0); k++) s.heist.openLock(vault.id, k, s.player);
      return s.heist.loot.all().reduce((n, b) => n + b.amount, 0);
    };
    // Loose office cash is also loot: compare only what the vault added.
    const before = (s: ReturnType<typeof setup>) =>
      s.heist.loot.all().reduce((n, b) => n + b.amount, 0);
    const b1 = before(quiet);
    const b2 = before(loud);
    const ghost = total(quiet, true) - b1;
    const normal = total(loud, false) - b2;
    expect(ghost).toBeGreaterThan(normal);
    expect(ghost).toBe(Math.round(normal * (1 + A.ghostBonus)));
  });

  it('lose the ghost bonus as soon as one lock is loud', () => {
    const { player, heist } = setup(false);
    const v = heist.vaults.get(vault.id);
    heist.setApproach(player, 'stealth');
    heist.openLock(vault.id, 1, player);
    heist.setApproach(player, 'loud');
    heist.openLock(vault.id, 2, player);
    expect(v?.ghost).toBe(false);
  });

  it('are off when the setting says so', () => {
    const { player, heist } = setup(false, { enabled: false });
    heist.setApproach(player, 'stealth');
    expect(player.speedScale).toBe(1);
    heist.openLock(vault.id, 1, player);
    expect(player.cash).toBe(0);
  });
});
