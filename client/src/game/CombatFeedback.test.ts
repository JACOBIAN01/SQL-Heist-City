import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  Flag,
  TEST_MAP,
  type InputCommand,
  type SelfState,
  type Vec3,
  type WeaponSpec,
} from '@heist/shared';
import { CombatFeedback, type CombatFeedbackDeps } from './CombatFeedback';

function setup(over: Partial<CombatFeedbackDeps> = {}) {
  const shots: string[] = [];
  let dry = 0;
  const hud = {
    setHealth: vi.fn(),
    setProtected: vi.fn(),
    flashDamage: vi.fn(),
    showHitMarker: vi.fn(),
    addKill: vi.fn(),
    addEvent: vi.fn(),
    setDead: vi.fn(),
    setPrompt: vi.fn(),
    setPurse: vi.fn(),
    setProgress: vi.fn(),
    setArms: vi.fn(),
    setAmmo: vi.fn(),
    toast: vi.fn(),
  };
  const tracers: { from: Vec3; to: Vec3 }[] = [];
  const feedback = new CombatFeedback({
    hud,
    tracers: { add: (from, to) => tracers.push({ from, to }) },
    map: TEST_MAP,
    movement: DEFAULT_MOVEMENT_SETTINGS,
    combat: DEFAULT_COMBAT_SETTINGS,
    myId: () => 1,
    myName: () => 'Me',
    nameOf: (id) => `P${id}`,
    positionOf: (id) => (id === 2 ? { x: 5, y: 0, z: 5 } : undefined),
    onLocalShot: (weapon) => shots.push(weapon),
    onDryFire: () => dry++,
    ...over,
  });
  return { hud, tracers, feedback, shots, dryFires: () => dry };
}

const self = (over: Partial<SelfState> = {}): SelfState => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  flags: Flag.Alive | Flag.OnGround,
  hp: 100,
  weapon: 4,
  ammo: 25,
  vehicle: 0,
  ...over,
});
const firing = (over: Partial<InputCommand> = {}): InputCommand => ({
  seq: 1,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: Button.Fire,
  viewLagMs: 0,
  ...over,
});
const body = { x: 0, y: 0, z: 0, crouching: false };

describe('CombatFeedback: health and death', () => {
  it('shows health and flashes only when it drops', () => {
    const { hud, feedback } = setup();
    feedback.onSnapshot(self({ hp: 100 }), 0);
    expect(hud.flashDamage).not.toHaveBeenCalled();
    feedback.onSnapshot(self({ hp: 72 }), 1);
    expect(hud.flashDamage).toHaveBeenCalledOnce();
    expect(hud.setHealth).toHaveBeenLastCalledWith(72, 100);
    feedback.onSnapshot(self({ hp: 72 }), 2);
    expect(hud.flashDamage).toHaveBeenCalledOnce();
  });

  it('shows the death screen with a countdown from the moment of death, then hides it', () => {
    const { hud, feedback } = setup();
    feedback.onSnapshot(self(), 10);
    feedback.onSnapshot(self({ hp: 0, flags: 0 }), 11);
    expect(feedback.isAlive).toBe(false);
    expect(hud.setDead).toHaveBeenLastCalledWith(true, DEFAULT_COMBAT_SETTINGS.respawnDelaySec);
    feedback.onSnapshot(self({ hp: 0, flags: 0 }), 13);
    expect(hud.setDead).toHaveBeenLastCalledWith(true, DEFAULT_COMBAT_SETTINGS.respawnDelaySec - 2);
    feedback.onSnapshot(self({ hp: 50 }), 17);
    expect(feedback.isAlive).toBe(true);
    expect(hud.setDead).toHaveBeenLastCalledWith(false, expect.any(Number));
  });

  it('shows spawn protection only while alive', () => {
    const { hud, feedback } = setup();
    feedback.onSnapshot(self({ flags: Flag.Alive | Flag.Protected }), 0);
    expect(hud.setProtected).toHaveBeenLastCalledWith(true);
    feedback.onSnapshot(self({ flags: Flag.Protected }), 1);
    expect(hud.setProtected).toHaveBeenLastCalledWith(false);
  });
});

describe('CombatFeedback: shots', () => {
  it('draws your own trail at once, paced by the weapon rate, ending at the first wall', () => {
    const { tracers, feedback } = setup();
    feedback.onSnapshot(self(), 0);
    feedback.onLocalCommand(firing(), body);
    expect(tracers).toHaveLength(1);
    // Rifle 450 rpm = every 8 commands: the next 7 commands add nothing.
    for (let i = 0; i < 7; i++) feedback.onLocalCommand(firing(), body);
    expect(tracers).toHaveLength(1);
    feedback.onLocalCommand(firing(), body);
    expect(tracers).toHaveLength(2);
    expect(tracers[0]?.to.z).toBeLessThan(0); // faces −z
  });

  it('draws nothing without the fire button, or when dead', () => {
    const { tracers, feedback } = setup();
    feedback.onSnapshot(self(), 0);
    feedback.onLocalCommand(firing({ buttons: 0 }), body);
    feedback.onSnapshot(self({ flags: 0, hp: 0 }), 1);
    feedback.onLocalCommand(firing(), body);
    expect(tracers).toHaveLength(0);
  });

  it('shows a hit marker for your confirmed hits, not misses, and does not duplicate your trail', () => {
    const { hud, tracers, feedback } = setup();
    feedback.onEvent({ e: 'shot', shooter: 1, endX: 0, endY: 0, endZ: 0, hit: 'head', target: 2 });
    feedback.onEvent({ e: 'shot', shooter: 1, endX: 0, endY: 0, endZ: 0, hit: 'miss', target: 0 });
    expect(hud.showHitMarker).toHaveBeenCalledTimes(1);
    expect(hud.showHitMarker).toHaveBeenCalledWith(true);
    expect(tracers).toHaveLength(0);
  });

  it('draws other players’ trails from where they are, when known', () => {
    const { hud, tracers, feedback } = setup();
    feedback.onEvent({ e: 'shot', shooter: 2, endX: 1, endY: 1, endZ: 1, hit: 'body', target: 1 });
    feedback.onEvent({ e: 'shot', shooter: 3, endX: 1, endY: 1, endZ: 1, hit: 'miss', target: 0 });
    expect(tracers).toHaveLength(1);
    expect(tracers[0]?.from).toEqual({ x: 5, y: 1.4, z: 5 });
    expect(hud.showHitMarker).not.toHaveBeenCalled();
  });
});

describe('CombatFeedback: kill feed', () => {
  it('names players, marking kills that involve you', () => {
    const { hud, feedback } = setup();
    feedback.onEvent({ e: 'kill', killer: 1, victim: 2 });
    feedback.onEvent({ e: 'kill', killer: 2, victim: 3 });
    expect(hud.addKill).toHaveBeenNthCalledWith(1, 'Me', 'P2', true);
    expect(hud.addKill).toHaveBeenNthCalledWith(2, 'P2', 'P3', false);
  });
});

describe('CombatFeedback ammo and weapons', () => {
  it('draws no trail while unarmed', () => {
    const { feedback, tracers } = setup();
    feedback.onSnapshot(self({ weapon: 0, ammo: 0 }), 0);
    feedback.onLocalCommand(firing(), { x: 0, y: 0, z: 0, crouching: false });
    expect(tracers).toHaveLength(0);
  });

  it('draws no trail with an empty magazine, and shows the rounds left', () => {
    const { feedback, tracers, hud, shots, dryFires } = setup();
    feedback.onSnapshot(self({ weapon: 4, ammo: 0 }), 0);
    expect(hud.setAmmo).toHaveBeenLastCalledWith(0);
    feedback.onLocalCommand(firing(), { x: 0, y: 0, z: 0, crouching: false });
    expect(tracers).toHaveLength(0);
    expect(shots).toEqual([]);
    expect(dryFires()).toBe(1); // click
  });

  it('paces fire by the server’s numbers once they arrive', () => {
    const slow = { ...DEFAULT_COMBAT_SETTINGS.weapons.rifle, rpm: 60 } as WeaponSpec;
    const { feedback, shots } = setup({
      weapons: { get: (id) => (id === 'rifle' ? slow : undefined) },
    });
    feedback.onSnapshot(self({ weapon: 4, ammo: 25 }), 0);
    for (let i = 0; i < 30; i++) feedback.onLocalCommand(firing({ seq: i + 1 }), body);
    expect(shots).toHaveLength(1); // one round a second, not 450 a minute
  });

  it('reports each shot fired with the gun in hand (for the bang)', () => {
    const { feedback, shots } = setup();
    feedback.onSnapshot(self({ weapon: 4, ammo: 5 }), 0);
    feedback.onLocalCommand(firing(), body);
    expect(shots).toEqual(['rifle']);
  });

  it('stops drawing trails once the shots already sent would empty the magazine', () => {
    const { feedback, tracers } = setup();
    feedback.onSnapshot(self({ weapon: 4, ammo: 2 }), 0);
    const body = { x: 0, y: 0, z: 0, crouching: false };
    // Fire three times, a full cooldown apart: the server has 2 rounds, so only 2 trails.
    for (let seq = 1; seq <= 3; seq++) {
      feedback.onLocalCommand(firing({ seq }), body);
      for (let i = 0; i < 10; i++)
        feedback.onLocalCommand(firing({ seq: 100 + seq * 10 + i, buttons: 0 }), body);
    }
    expect(tracers).toHaveLength(2);
  });

  it('counts a shot as spent only until the server acknowledges it', () => {
    const { feedback, tracers } = setup();
    feedback.onSnapshot(self({ weapon: 4, ammo: 1 }), 0);
    const body = { x: 0, y: 0, z: 0, crouching: false };
    feedback.onLocalCommand(firing({ seq: 1 }), body);
    expect(tracers).toHaveLength(1);
    // The server saw seq 1 and still reports 1 round (e.g. a refill): firing is allowed again.
    feedback.onSnapshot(self({ weapon: 4, ammo: 1 }), 0.1, 1);
    for (let i = 0; i < 10; i++) feedback.onLocalCommand(firing({ seq: 50 + i, buttons: 0 }), body);
    feedback.onLocalCommand(firing({ seq: 2 }), body);
    expect(tracers).toHaveLength(2);
  });
});
