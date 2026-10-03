import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { CharacterModel, PALETTES } from './CharacterModel';
import { thresholdsFor } from './animation';

const make = () =>
  new CharacterModel(PALETTES[0] ?? { shirt: 0, trousers: 0, skin: 0 }, thresholdsFor(4, 7));
const still = { speed: 0, crouching: false, onGround: true };

describe('CharacterModel', () => {
  it('stays small: six meshes per character', () => {
    let meshes = 0;
    make().root.traverse((o) => {
      if (o instanceof Mesh) meshes++;
    });
    expect(meshes).toBe(6);
  });

  it('shares geometry between characters', () => {
    const geometries = (m: CharacterModel) => {
      const set = new Set<unknown>();
      m.root.traverse((o) => o instanceof Mesh && set.add(o.geometry));
      return set;
    };
    const a = geometries(make());
    const b = geometries(make());
    expect([...a].every((g) => b.has(g))).toBe(true);
  });

  it('picks the clip from motion', () => {
    const m = make();
    m.update(still, 0.016);
    expect(m.animation).toBe('idle');
    m.update({ ...still, speed: 4 }, 0.016);
    expect(m.animation).toBe('jog');
    m.update({ ...still, speed: 7 }, 0.016);
    expect(m.animation).toBe('sprint');
  });

  it('swings legs in opposite directions while walking', () => {
    const m = make();
    for (let i = 0; i < 12; i++) m.update({ ...still, speed: 4 }, 0.05);
    expect(m.legL.rotation.x).toBeCloseTo(-m.legR.rotation.x);
    expect(Math.abs(m.legL.rotation.x)).toBeGreaterThan(0.05);
  });

  it('lowers the body when crouching and raises the arms in the air', () => {
    const m = make();
    m.update({ ...still, crouching: true }, 0.016);
    expect(m.body.position.y).toBeLessThan(-0.2);
    m.update({ speed: 3, crouching: false, onGround: false }, 0.016);
    expect(m.armL.rotation.x).toBeLessThan(-0.5);
  });
});
