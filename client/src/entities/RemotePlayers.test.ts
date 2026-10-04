import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { Flag, flagsWithWeapon, type EntityState } from '@heist/shared';
import { RemotePlayers } from './RemotePlayers';
import { CharacterModel, PALETTES } from './CharacterModel';
import { thresholdsFor } from './animation';

const entity = (id: number, x: number, over: Partial<EntityState> = {}): EntityState => ({
  id,
  x,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  flags: Flag.Alive | Flag.OnGround,
  hp: 100,
  ...over,
});

const make = () => {
  const scene = new Scene();
  return {
    scene,
    remotes: new RemotePlayers(
      scene,
      (seed) =>
        new CharacterModel(
          PALETTES[seed % PALETTES.length] ?? PALETTES[0] ?? { shirt: 0, trousers: 0, skin: 0 },
          thresholdsFor(4, 7),
        ),
    ),
  };
};

describe('RemotePlayers', () => {
  it('adds a model per player and places it by interpolation', () => {
    const { scene, remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0)]);
    remotes.onSnapshot(50, [entity(2, 4)]);
    expect(remotes.count).toBe(1);
    expect(scene.children).toHaveLength(1);
    // 50 ms updates → drawn 75 ms behind; server time 100 renders t = 25, half-way.
    remotes.update(100, 0.016, 0);
    expect(scene.children[0]?.position.x).toBeCloseTo(2);
  });

  it('removes a player on a left event and uses joined names', () => {
    const { scene, remotes } = make();
    remotes.onEvent({ e: 'joined', id: 2, name: 'Ben' });
    remotes.onSnapshot(0, [entity(2, 0)]);
    expect(remotes.nameOf(2)).toBe('Ben');
    remotes.onEvent({ e: 'left', id: 2 });
    expect(remotes.count).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('removes players the server says left the area of interest', () => {
    const { scene, remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0), entity(3, 5)]);
    remotes.onSnapshot(50, [], [2]);
    expect(remotes.count).toBe(1);
    expect(scene.children).toHaveLength(1);
  });

  it('keeps players the server has simply not mentioned (they have not changed)', () => {
    const { remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0)]);
    for (let i = 1; i <= 100; i++) remotes.onSnapshot(i * 50, []);
    expect(remotes.count).toBe(1);
  });

  it('does not glide a long-stationary player across the silence when they start moving', () => {
    const { scene, remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0)]);
    remotes.onSnapshot(10_000, [entity(2, 5)]); // stood still 10 s, then moved
    remotes.update(9_900, 0.016, 0); // 100 ms before the move: still at the old spot
    expect(scene.children[0]?.position.x).toBeCloseTo(0, 1);
    remotes.update(10_100, 0.016, 0);
    expect(scene.children[0]?.position.x).toBeGreaterThan(4);
  });

  it('hides players who are dead', () => {
    const { scene, remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0, { flags: 0 })]);
    remotes.update(0, 0.016, 0);
    expect(scene.children[0]?.visible).toBe(false);
  });

  it('draws rarely-updated players further behind so they keep moving smoothly', () => {
    const { scene, remotes } = make();
    // A distant player: the server sends them only every 200 ms.
    remotes.onSnapshot(0, [entity(2, 0)]);
    remotes.onSnapshot(200, [entity(2, 8)]);
    remotes.onSnapshot(400, [entity(2, 16)]);
    // Server time 450, base delay 100: 1.5 × 200 = 300 ms behind → renders at t = 150.
    remotes.update(450, 0.016, 100);
    expect(scene.children[0]?.position.x).toBeCloseTo(6);
    // A nearby player (50 ms updates) uses just the base delay.
    const near = make();
    near.remotes.onSnapshot(0, [entity(3, 0)]);
    near.remotes.onSnapshot(50, [entity(3, 2)]);
    near.remotes.onSnapshot(100, [entity(3, 4)]);
    near.remotes.update(150, 0.016, 100); // renders at t = 50
    expect(near.scene.children[0]?.position.x).toBeCloseTo(2);
  });

  it('falls back to a generic name', () => {
    expect(make().remotes.nameOf(9)).toBe('Player 9');
  });

  it('shows the cash bag of a player who is carrying cash, and hides it again', () => {
    const { scene, remotes } = make();
    const carrying = Flag.Alive | Flag.OnGround | Flag.Carrying;
    remotes.onSnapshot(0, [entity(2, 0, { flags: carrying })]);
    remotes.onSnapshot(50, [entity(2, 0, { flags: carrying })]);
    remotes.update(200, 0.016, 0);
    const bag = () => scene.getObjectByName('cash-bag');
    expect(bag()?.visible).toBe(true);
    remotes.onSnapshot(100, [entity(2, 0)]);
    remotes.onSnapshot(150, [entity(2, 0)]);
    remotes.update(400, 0.016, 0);
    expect(bag()?.visible).toBe(false);
  });
});

describe('RemotePlayers guns', () => {
  it('puts the gun a player holds in their hands, from the snapshot flags', () => {
    const { scene, remotes } = make();
    const armed = flagsWithWeapon(Flag.Alive | Flag.OnGround, 4); // rifle
    remotes.onSnapshot(0, [entity(2, 0, { flags: armed })]);
    remotes.onSnapshot(50, [entity(2, 0, { flags: armed })]);
    remotes.update(200, 0.016, 0);
    expect(scene.getObjectByName('gun-rifle')).toBeDefined();
    const unarmed = Flag.Alive | Flag.OnGround;
    remotes.onSnapshot(100, [entity(2, 0, { flags: unarmed })]);
    remotes.onSnapshot(150, [entity(2, 0, { flags: unarmed })]);
    remotes.update(400, 0.016, 0);
    expect(scene.getObjectByName('gun-rifle')).toBeUndefined();
  });
});

describe('RemotePlayers character LOD', () => {
  it('switches a player to the light body beyond ~25 m from the camera, without flickering', () => {
    const calls: boolean[] = [];
    const scene = new Scene();
    const remotes = new RemotePlayers(scene, () => {
      const rig = new CharacterModel(
        PALETTES[0] ?? { shirt: 0, trousers: 0, skin: 0 },
        thresholdsFor(4, 7),
      );
      rig.setFar = (far) => void calls.push(far);
      return rig;
    });
    let t = 0;
    // A steady 20 Hz stream at x for a second, drawn as it arrives.
    const at = (x: number) => {
      for (let k = 0; k < 20; k++, t += 50) {
        remotes.onSnapshot(t, [entity(2, x)]);
        remotes.update(t, 0.016, 0, { x: 0, z: 0 });
      }
    };
    at(10);
    expect(calls).toEqual([]);
    at(30);
    expect(calls).toEqual([true]);
    at(25); // between the two thresholds: stays light
    expect(calls).toEqual([true]);
    at(20);
    expect(calls).toEqual([true, false]);
  });
});
