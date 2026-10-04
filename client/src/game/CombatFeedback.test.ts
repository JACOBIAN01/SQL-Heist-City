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
} from '@heist/shared';
import { CombatFeedback } from './CombatFeedback';

function setup() {
  const hud = {
    setHealth: vi.fn(),
    setProtected: vi.fn(),
    flashDamage: vi.fn(),
    showHitMarker: vi.fn(),
    addKill: vi.fn(),
    setDead: vi.fn(),
    setPrompt: vi.fn(),
    setPurse: vi.fn(),
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
  });
  return { hud, tracers, feedback };
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
