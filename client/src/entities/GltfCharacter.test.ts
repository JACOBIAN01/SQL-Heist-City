import { describe, expect, it } from 'vitest';
import type { Color } from 'three';
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Texture,
} from 'three';
import { thresholdsFor } from './animation';
import { CLIP_FOR, GltfCharacter } from './GltfCharacter';

/** A stand-in for the loaded GLB: the recolourable body, hair and eyes. */
function template() {
  const root = new Group();
  const make = (name: string) => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name }));
    root.add(mesh);
    return mesh;
  };
  const parts = { body: make('body'), hair: make('MI_Hair_1'), eyes: make('MI_Eyes') };
  return { root, parts };
}

const clips = new Map(
  Object.values(CLIP_FOR).map((name) => [
    name,
    new AnimationClip(name, 1, [new NumberKeyframeTrack('.rotation[x]', [0, 1], [0, 1])]),
  ]),
);
const look = { shirt: 0xff0000, trousers: 0x00ff00, shoes: 0x0000ff };
const thresholds = thresholdsFor(4.2, 6.8);
const still = { speed: 0, crouching: false, onGround: true };

const meshesOf = (c: GltfCharacter) => {
  const out: Mesh[] = [];
  c.object.traverse((n) => (n as Mesh).isMesh && out.push(n as Mesh));
  return out;
};
const byName = (c: GltfCharacter, name: string) =>
  meshesOf(c).find((m) => (m.material as MeshStandardMaterial).name === name) as Mesh;

/** Runs the material's shader hook on a minimal fake shader and returns what it produced. */
function compile(material: MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('GltfCharacter: look', () => {
  it('recolours the body by region through the shader, using this player’s colours', () => {
    const c = new GltfCharacter(template().root, clips, look, thresholds);
    const shader = compile(byName(c, 'body').material as MeshStandardMaterial);
    expect((shader.uniforms.uShirt?.value as Color).getHex()).toBe(0xff0000);
    expect((shader.uniforms.uTrousers?.value as Color).getHex()).toBe(0x00ff00);
    expect((shader.uniforms.uShoes?.value as Color).getHex()).toBe(0x0000ff);
    expect(shader.vertexShader).toContain('attribute float _region');
    expect(shader.fragmentShader).toContain('floor(vRegion + 0.5)');
  });

  it('gives each player their own colours but one shared compiled program', () => {
    const t = template();
    const a = new GltfCharacter(t.root, clips, look, thresholds);
    const b = new GltfCharacter(t.root, clips, { ...look, shirt: 0x123456 }, thresholds);
    const ma = byName(a, 'body').material as MeshStandardMaterial;
    const mb = byName(b, 'body').material as MeshStandardMaterial;
    expect(ma).not.toBe(mb);
    expect(ma).not.toBe(t.parts.body.material);
    expect((compile(mb).uniforms.uShirt?.value as Color).getHex()).toBe(0x123456);
    expect((compile(ma).uniforms.uShirt?.value as Color).getHex()).toBe(0xff0000);
    expect(ma.customProgramCacheKey()).toBe(mb.customProgramCacheKey());
  });

  it('shares hair and eye materials between players', () => {
    const t = template();
    const a = new GltfCharacter(t.root, clips, look, thresholds);
    expect(byName(a, 'MI_Hair_1').material).toBe(t.parts.hair.material);
    expect(byName(a, 'MI_Eyes').material).toBe(t.parts.eyes.material);
  });

  it('can swap in a different skin texture', () => {
    const skin = new Texture();
    const c = new GltfCharacter(template().root, clips, { ...look, skin }, thresholds);
    expect((byName(c, 'body').material as MeshStandardMaterial).map).toBe(skin);
  });

  it('turns the model to face the game’s forward; eyes do not cast shadows', () => {
    const c = new GltfCharacter(template().root, clips, look, thresholds);
    expect(c.object.children[0]?.rotation.y).toBeCloseTo(Math.PI);
    expect(byName(c, 'body').castShadow).toBe(true);
    expect(byName(c, 'MI_Eyes').castShadow).toBe(false);
  });
});

describe('GltfCharacter: animation', () => {
  const playing = (c: GltfCharacter) =>
    // Which clip has weight right now (the last started one is the target).
    c.animation;

  it('chooses the clip from motion', () => {
    const c = new GltfCharacter(template().root, clips, look, thresholds);
    c.update(still, 0.016);
    expect(playing(c)).toBe('idle');
    c.update({ ...still, speed: 4.2 }, 0.016);
    expect(playing(c)).toBe('jog');
    c.update({ ...still, speed: 6.8 }, 0.016);
    expect(playing(c)).toBe('sprint');
    c.update({ speed: 0, crouching: true, onGround: true }, 0.016);
    expect(playing(c)).toBe('crouch');
    c.update({ speed: 3, crouching: false, onGround: false }, 0.016);
    expect(playing(c)).toBe('air');
  });

  it('crossfades instead of cutting: the old clip fades out while the new one fades in', () => {
    const c = new GltfCharacter(template().root, clips, look, thresholds);
    c.update(still, 0.016);
    c.update({ ...still, speed: 4.2 }, 0.05);
    const weight = (clip: string) =>
      (c as unknown as { actions: Map<string, { getEffectiveWeight(): number }> }).actions
        .get(clip)
        ?.getEffectiveWeight() ?? 0;
    expect(weight('Jog_Fwd_Loop')).toBeGreaterThan(0);
    expect(weight('Jog_Fwd_Loop')).toBeLessThan(1);
    expect(weight('Idle_Loop')).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) c.update({ ...still, speed: 4.2 }, 0.05);
    expect(weight('Jog_Fwd_Loop')).toBeCloseTo(1);
    expect(weight('Idle_Loop')).toBeCloseTo(0);
  });

  it('plays locomotion clips at a rate that follows ground speed, within limits', () => {
    const scale = (c: GltfCharacter, clip: string) =>
      (c as unknown as { actions: Map<string, { getEffectiveTimeScale(): number }> }).actions
        .get(clip)
        ?.getEffectiveTimeScale() ?? 0;
    const slow = new GltfCharacter(template().root, clips, look, thresholds);
    slow.update({ ...still, speed: 3 }, 0.016);
    const fast = new GltfCharacter(template().root, clips, look, thresholds);
    fast.update({ ...still, speed: 4.2 }, 0.016);
    expect(scale(fast, 'Jog_Fwd_Loop')).toBeGreaterThan(scale(slow, 'Jog_Fwd_Loop'));
    const absurd = new GltfCharacter(template().root, clips, look, thresholds);
    absurd.update({ ...still, speed: 50 }, 0.016);
    expect(scale(absurd, 'Sprint_Loop')).toBeLessThanOrEqual(1.6);
  });

  it('copes with a missing clip without throwing', () => {
    const c = new GltfCharacter(template().root, new Map(), look, thresholds);
    expect(() => c.update({ ...still, speed: 4.2 }, 0.016)).not.toThrow();
  });
});
