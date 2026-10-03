import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { Flag, type EntityState } from '@heist/shared';
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
    remotes.update(25, 0.016);
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

  it('forgets players who stop appearing in snapshots', () => {
    const { remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0)]);
    for (let i = 1; i <= 25; i++) remotes.onSnapshot(i * 50, []);
    expect(remotes.count).toBe(0);
  });

  it('hides players who are dead', () => {
    const { scene, remotes } = make();
    remotes.onSnapshot(0, [entity(2, 0, { flags: 0 })]);
    remotes.update(0, 0.016);
    expect(scene.children[0]?.visible).toBe(false);
  });

  it('falls back to a generic name', () => {
    expect(make().remotes.nameOf(9)).toBe('Player 9');
  });
});
