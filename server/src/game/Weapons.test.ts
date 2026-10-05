import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  PROTOCOL_VERSION,
  weaponSpecSchema,
  type CombatSettings,
  type GameMap,
  type InputCommand,
  type WeaponSpec,
} from '@heist/shared';
import { Match } from './Match';
import { FakeConnection } from './testing';

const open: GameMap = {
  id: 'range',
  halfSize: 200,
  boxes: [],
  spawns: [{ x: 150, z: 150, yaw: 0 }],
};

/** A match where everyone holds a rifle with these numbers (the sandbox hands out the rifle). */
function range(rifle: Partial<WeaponSpec>, source?: () => CombatSettings) {
  const combat: CombatSettings = {
    ...DEFAULT_COMBAT_SETTINGS,
    spawnProtectionSec: 0,
    weapons: {
      ...DEFAULT_COMBAT_SETTINGS.weapons,
      rifle: weaponSpecSchema.parse({ damage: 28, rpm: 450, range: 80, magSize: 25, ...rifle }),
    },
  };
  const match = new Match({
    map: open,
    settings: DEFAULT_MATCH_SETTINGS,
    combat,
    ...(source ? { combatSource: source } : {}),
  });
  const join = (name: string, x: number, z: number) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    Object.assign(r.player.body, { x, z });
    return { player: r.player, connection };
  };
  return { match, join };
}

let seq = 0;
const shot = (over: Partial<InputCommand> = {}): InputCommand => ({
  seq: ++seq,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: Button.Fire,
  viewLagMs: 0,
  ...over,
});

/** Fires `count` single shots, each after the cooldown, at a target `distance` m ahead; returns the hits. */
function volley(
  rifle: Partial<WeaponSpec>,
  distance: number,
  count: number,
  over: Partial<InputCommand> = {},
  shooterSpeed = 0,
) {
  const { match, join } = range(rifle);
  const a = join('A', 0, 0);
  const b = join('B', 0.55, -distance); // the bullet leaves 0.55 m right of A (shoulder)
  let hits = 0;
  for (let i = 0; i < count; i++) {
    b.player.hp = 100;
    a.player.body.vx = shooterSpeed; // as if running sideways
    match.receiveInput(a.player.id, [shot(over)]);
    match.step();
    if (b.player.hp < 100) hits++;
    // Let the cooldown pass: the server counts it down per command it applies.
    for (let t = 0; t < 4; t++) {
      match.receiveInput(a.player.id, [shot({ buttons: 0 }), shot({ buttons: 0 })]);
      match.step();
    }
  }
  return { hits, last: b };
}

describe('Weapons: damage falls off with distance', () => {
  it('does full damage up close and less past the falloff start', () => {
    const rifle = { falloffStart: 10, falloffMin: 0.5, spread: 0 };
    const near = volley(rifle, 8, 1);
    expect(near.last.player.hp).toBe(100 - 28);
    const far = volley(rifle, 45, 1); // half-way from 10 m to 80 m: 75% damage
    expect(far.last.player.hp).toBeCloseTo(100 - 28 * 0.75, 5);
  });
});

describe('Weapons: spread', () => {
  const wide = { spread: 0.12, aimSpread: 0 };

  it('aiming down the sights tightens the cone (here, to a pinpoint)', () => {
    expect(volley(wide, 30, 10, { buttons: Button.Fire | Button.Aim }).hits).toBe(10);
    expect(volley(wide, 30, 10).hits).toBeLessThan(10);
  });

  it('running spoils the aim of a gun with move spread', () => {
    const steady = { spread: 0, moveSpread: 0.15 };
    expect(volley(steady, 30, 10).hits).toBe(10);
    expect(volley(steady, 30, 10, {}, DEFAULT_MOVEMENT_SETTINGS.sprintSpeed).hits).toBeLessThan(10);
  });
});

describe('Weapons: the numbers clients get', () => {
  it('sends every gun to a player who joins', () => {
    const { join } = range({ damage: 33 });
    const { connection } = join('A', 0, 0);
    const message = connection.jsonOf('weapons')[0];
    expect(message?.weapons.rifle?.damage).toBe(33);
    expect(Object.keys(message?.weapons ?? {})).toEqual(
      expect.arrayContaining(['pistol', 'smg', 'shotgun', 'rifle', 'sniper']),
    );
  });

  it('picks up retuned guns between rounds and tells everyone', () => {
    let damage = 28;
    const source = (): CombatSettings => ({
      ...DEFAULT_COMBAT_SETTINGS,
      weapons: {
        ...DEFAULT_COMBAT_SETTINGS.weapons,
        rifle: weaponSpecSchema.parse({ damage, rpm: 450, range: 80, magSize: 25 }),
      },
    });
    const { match, join } = range({}, source);
    const { connection } = join('A', 0, 0);
    damage = 40;
    match.refreshCombat();
    expect(match.weaponSpec('rifle')?.damage).toBe(40);
    expect(connection.jsonOf('weapons').at(-1)?.weapons.rifle?.damage).toBe(40);
  });
});
