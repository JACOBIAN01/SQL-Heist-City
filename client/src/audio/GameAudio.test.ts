import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  Flag,
  type GameMap,
  type MapAnchor,
} from '@heist/shared';
import type { AudioOut, LoopHandle, PlayOptions, Point } from './AudioEngine';
import { GameAudio, type HeardCar, type HeardPlayer, type HearingFrame } from './GameAudio';
import type { SoundName } from './synth';

class RecordingOut implements AudioOut {
  readonly played: { name: SoundName; options: PlayOptions }[] = [];
  readonly loops: {
    name: SoundName;
    options: PlayOptions;
    at?: Point;
    rate: number;
    volume: number;
    stopped: boolean;
  }[] = [];
  now = 0;
  play(name: SoundName, options: PlayOptions = {}): void {
    this.played.push({ name, options });
  }
  loop(name: SoundName, options: PlayOptions = {}): LoopHandle {
    const entry = {
      name,
      options,
      ...(options.at ? { at: options.at } : {}),
      rate: options.rate ?? 1,
      volume: options.volume ?? 1,
      stopped: false,
    };
    this.loops.push(entry);
    return {
      move: (at) => (entry.at = at),
      setRate: (r) => (entry.rate = r),
      setVolume: (v) => (entry.volume = v),
      stop: () => (entry.stopped = true),
    };
  }
  setListener(): void {}
  names(): SoundName[] {
    return this.played.map((p) => p.name);
  }
  live(name: SoundName) {
    return this.loops.filter((l) => l.name === name && !l.stopped);
  }
}

const vaultAnchor: MapAnchor = {
  id: 'b1:console',
  kind: 'vault_console',
  x: 50,
  y: 8,
  z: 0,
  radius: 1.5,
  storey: 2,
};
const MAP: GameMap = {
  id: 'm',
  halfSize: 400,
  boxes: [],
  spawns: [],
  anchors: [vaultAnchor],
  vaults: [{ id: 'v1', bank: 'b1', tier: 1, doorId: 'd', consoleId: 'b1:console', loot: [] }],
};

function setup(over: Partial<{ weapon: number }> = {}) {
  const out = new RecordingOut();
  const positions = new Map<number, Point>([[2, { x: 30, y: 0, z: 0 }]]);
  const audio = new GameAudio({
    out,
    settings: DEFAULT_AUDIO_SETTINGS,
    vehicles: DEFAULT_VEHICLE_SETTINGS,
    map: MAP,
    myId: () => 1,
    positionOf: (id) => positions.get(id),
    weaponOf: () => over.weapon ?? 3,
    random: () => 0.5,
  });
  return { out, audio, positions };
}

const ALIVE_ON_GROUND = Flag.Alive | Flag.OnGround;
function frame(over: Partial<HearingFrame> & { meX?: number } = {}): HearingFrame {
  return {
    dt: 1 / 60,
    listener: {
      at: { x: over.meX ?? 0, y: 1.6, z: 4 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    },
    me: {
      x: over.meX ?? 0,
      y: 0,
      z: 0,
      onGround: true,
      crouching: false,
      alive: true,
      driving: false,
    },
    others: [],
    drivers: new Set(),
    cars: [],
    ...over,
  };
}

describe('GameAudio: guns', () => {
  it('plays your own gun at once, then only the hit tick when the server confirms it', () => {
    const { out, audio } = setup();
    audio.localShot('rifle');
    expect(out.played[0]).toMatchObject({ name: 'shot-rifle', options: { echo: true } });
    expect(out.played[0]?.options.at).toBeUndefined(); // in your own hands
    audio.onEvent({ e: 'shot', shooter: 1, endX: 0, endY: 0, endZ: 0, hit: 'body', target: 2 });
    audio.onEvent({ e: 'shot', shooter: 1, endX: 0, endY: 0, endZ: 0, hit: 'miss', target: 0 });
    expect(out.names()).toEqual(['shot-rifle', 'hit']);
  });

  it('plays someone else’s shot from where they stand, with their gun, carrying far', () => {
    const { out, audio } = setup({ weapon: 3 });
    audio.onEvent({ e: 'shot', shooter: 2, endX: 0, endY: 0, endZ: 0, hit: 'miss', target: 0 });
    expect(out.played[0]).toMatchObject({
      name: 'shot-shotgun',
      options: { at: { x: 30, y: 1.4, z: 0 }, echo: true },
    });
    expect(out.played[0]?.options.range).toBe(DEFAULT_AUDIO_SETTINGS.shotRange);
  });

  it('clicks on an empty gun, but not on every step while the trigger is held', () => {
    const { out, audio } = setup();
    for (let i = 0; i < 30; i++) {
      audio.dryFire();
      audio.update(frame());
    }
    expect(out.names().filter((n) => n === 'dry-fire')).toHaveLength(2); // 0.5 s, one per 0.3 s
  });

  it('hurts when your health drops, not when it rises or you die', () => {
    const { out, audio } = setup();
    audio.onHealth(100, true);
    audio.onHealth(80, true);
    audio.onHealth(100, true);
    audio.onHealth(0, false);
    expect(out.names()).toEqual(['hurt']);
  });
});

describe('GameAudio: footsteps', () => {
  const walkFor = (audio: GameAudio, seconds: number, over: Partial<HearingFrame> = {}) => {
    for (let i = 0; i < seconds * 60; i++) {
      const me = { ...frame().me, ...over.me, x: (i / 60) * 4.2 };
      audio.update(frame({ ...over, me, meX: me.x }));
    }
  };

  it('steps as you walk, on what is underfoot, and not while driving', () => {
    const { out, audio } = setup();
    walkFor(audio, 2);
    const steps = out.names().filter((n) => n === 'step-concrete');
    expect(steps.length).toBeGreaterThanOrEqual(5);
    const quiet = setup();
    walkFor(quiet.audio, 2, { me: { ...frame().me, driving: true } });
    expect(quiet.out.names()).not.toContain('step-concrete');
  });

  it('hears others walking nearby, quieter crouching, and not drivers or the far away', () => {
    const { out, audio } = setup();
    // Each walks along x on their own line of z.
    const walker = (id: number, z: number, flags: number) => (i: number) =>
      ({ id, x: (i / 60) * 4.2, y: 0, z, flags }) as HeardPlayer;
    const near = walker(2, 5, ALIVE_ON_GROUND);
    const sneaky = walker(3, -5, ALIVE_ON_GROUND | Flag.Crouching);
    const far = walker(4, 200, ALIVE_ON_GROUND);
    const driver = walker(5, 12, ALIVE_ON_GROUND);
    for (let i = 0; i < 120; i++)
      audio.update(
        frame({
          me: { ...frame().me, onGround: false }, // keep our own feet out of it
          others: [near(i), sneaky(i), far(i), driver(i)],
          drivers: new Set([5]),
        }),
      );
    const at = (z: number) => out.played.filter((p) => p.options.at?.z === z);
    expect(at(5).length).toBeGreaterThan(3);
    expect(at(-5).length).toBeGreaterThan(3);
    expect(at(-5)[0]?.options.volume).toBeLessThan(at(5)[0]?.options.volume ?? 0);
    expect(at(200)).toHaveLength(0);
    expect(at(12)).toHaveLength(0); // the driver sits in their car
  });
});

describe('GameAudio: cars', () => {
  const car = (over: Partial<HeardCar>): HeardCar => ({
    id: 1,
    kind: 'sedan',
    x: 10,
    z: 0,
    speed: 0,
    driver: 0,
    ...over,
  });

  it('runs an engine for driven cars nearby, higher-pitched with speed', () => {
    const { out, audio } = setup();
    audio.update(frame({ cars: [car({ driver: 7 }), car({ id: 2, x: 15 })] }));
    expect(out.live('engine')).toHaveLength(1); // the parked one is silent
    const idle = out.live('engine')[0]?.rate ?? 0;
    audio.update(frame({ cars: [car({ driver: 7, speed: 15 })] }));
    expect(out.live('engine')[0]?.rate).toBeGreaterThan(idle);
    // Driven away out of earshot: the engine stops.
    audio.update(frame({ cars: [car({ driver: 7, speed: 15, x: 500 })] }));
    expect(out.live('engine')).toHaveLength(0);
  });

  it('hears only the nearest few engines', () => {
    const { out, audio } = setup();
    const cars = Array.from({ length: 9 }, (_, i) => car({ id: i + 1, x: 5 + i * 3, driver: 9 }));
    audio.update(frame({ cars }));
    expect(out.live('engine')).toHaveLength(DEFAULT_AUDIO_SETTINGS.maxEngines);
  });

  it('crashes when a car suddenly loses speed, not when it brakes', () => {
    const { out, audio } = setup();
    audio.update(frame({ cars: [car({ driver: 7, speed: 15 })] }));
    audio.update(frame({ cars: [car({ driver: 7, speed: 14.2 })] })); // braking
    expect(out.names()).not.toContain('crash');
    audio.update(frame({ cars: [car({ driver: 7, speed: -3 })] })); // bounced off a wall
    expect(out.played.find((p) => p.name === 'crash')?.options.volume).toBeGreaterThan(0.9);
  });
});

describe('GameAudio: heist and ambience', () => {
  it('rings the vault’s alarm when a lock is cracked, for a while, but not for old news', () => {
    const { out, audio } = setup();
    audio.onVaults([{ id: 'v1', tier: 1, locks: 3, opened: 1 }]); // on join
    expect(out.live('alarm')).toHaveLength(0);
    audio.onVaults([{ id: 'v1', tier: 1, locks: 3, opened: 2 }]);
    expect(out.live('alarm')[0]?.at).toMatchObject({ x: 50, z: 0 });
    const seconds = DEFAULT_AUDIO_SETTINGS.alarmSeconds;
    for (let t = 0; t < seconds - 1; t++) audio.update({ ...frame(), dt: 1 });
    expect(out.live('alarm')).toHaveLength(1);
    audio.update({ ...frame(), dt: 2 });
    expect(out.live('alarm')).toHaveLength(0);
  });

  it('chimes for cash picked up and for cash banked', () => {
    const { out, audio } = setup();
    audio.onPurse(0, 0);
    audio.onPurse(500, 0);
    audio.onPurse(0, 500);
    expect(out.names()).toEqual(['cash', 'bank']);
  });

  it('keeps wind blowing, and now and then a far-off siren passes', () => {
    const { out, audio } = setup();
    audio.update(frame());
    expect(out.live('wind')).toHaveLength(1);
    expect(out.live('wind')[0]?.at).toBeUndefined();
    const { sirenMinSeconds, sirenMaxSeconds } = DEFAULT_AUDIO_SETTINGS;
    for (let t = 0; t < (sirenMinSeconds + sirenMaxSeconds) / 2 + 1; t++)
      audio.update({ ...frame(), dt: 1 });
    const siren = out.live('siren')[0];
    expect(siren).toBeDefined();
    expect(Math.hypot(siren?.at?.x ?? 0, (siren?.at?.z ?? 0) - 4)).toBeGreaterThan(100);
    for (let t = 0; t < 10; t++) audio.update({ ...frame(), dt: 1 });
    expect(out.live('siren')).toHaveLength(0);
    expect(out.live('wind')).toHaveLength(1);
  });
});
