import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Color } from 'three';
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  Object3D,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Texture,
  Vector3,
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

describe('GltfCharacter gun handling', () => {
  /** A body with the two bones the gun moves between, and the aim clips. */
  function armed() {
    const t = template();
    for (const name of ['spine_03', 'hand_r']) {
      const bone = new Object3D();
      bone.name = name;
      t.root.add(bone);
    }
    const withAim = new Map(clips);
    for (const name of ['Pistol_Idle_Loop', 'Pistol_Shoot'])
      withAim.set(
        name,
        new AnimationClip(name, 1, [
          new NumberKeyframeTrack('hand_r.rotation[x]', [0, 1], [0, 1]),
          new NumberKeyframeTrack('thigh_l.rotation[x]', [0, 1], [0, 1]),
        ]),
      );
    const c = new GltfCharacter(t.root, withAim, look, thresholds);
    const gun = new Group();
    c.holdItem(gun);
    return {
      c,
      gun,
      // The character clones the template, so its bones are the clone's.
      back: c.object.getObjectByName('spine_03'),
      hand: c.object.getObjectByName('hand_r'),
    };
  }

  it('carries the gun slung on the back until the player fires', () => {
    const { c, gun } = armed();
    expect(gun.parent).toBe(c.object);
    expect(c.isAiming).toBe(false);
    c.update(still, 0.5);
    expect(c.gunIn).toBe('back');
  });

  it('draws on the first shot: aims at once, the gun reaches the shoulder within the draw', () => {
    const { c } = armed();
    c.fired();
    expect(c.isAiming).toBe(true);
    c.update(still, 0.05);
    expect(c.gunIn).toBe('back'); // still on its way
    for (let i = 0; i < 20; i++) c.update(still, 1 / 60);
    expect(c.gunIn).toBe('hand');
  });

  it('points the drawn gun the way the character faces, and up or down with the aim', () => {
    const { c, gun } = armed();
    c.setAimPitch(0.3);
    c.fired();
    for (let i = 0; i < 60; i++) c.update(still, 1 / 60);
    const muzzle = new Vector3(0, 0, -1).applyQuaternion(gun.quaternion);
    expect(muzzle.z).toBeLessThan(-0.9); // forward is −z in character space
    expect(muzzle.y).toBeGreaterThan(0.2);
  });

  it('flashes the muzzle for a moment on each shot once the gun is up', () => {
    const { c, gun } = armed();
    const flash = new Group();
    flash.name = 'muzzle-flash';
    gun.add(flash);
    c.fired();
    for (let i = 0; i < 30; i++) c.update(still, 1 / 60);
    expect(flash.visible).toBe(false);
    c.fired();
    c.update(still, 1 / 60);
    expect(flash.visible).toBe(true);
    c.update(still, 0.1);
    expect(flash.visible).toBe(false);
  });

  it('stays at the ready while shooting, then lowers and slings the gun after a pause', () => {
    const { c } = armed();
    c.fired();
    c.update(still, 0.4);
    for (let i = 0; i < 4; i++) {
      c.fired(); // a burst keeps resetting the timer
      c.update(still, 0.5);
    }
    expect(c.isAiming).toBe(true);
    c.update(still, 2.1); // no more shots
    expect(c.isAiming).toBe(false);
    for (let i = 0; i < 40; i++) c.update(still, 1 / 60);
    expect(c.gunIn).toBe('back');
  });

  it('raises the gun while aim is held, without a flash, and lowers it soon after', () => {
    const { c, gun } = armed();
    const flash = new Group();
    flash.name = 'muzzle-flash';
    gun.add(flash);
    for (let i = 0; i < 30; i++) {
      c.raise();
      c.update(still, 1 / 60);
    }
    expect(c.isAiming).toBe(true);
    expect(c.gunIn).toBe('hand');
    expect(flash.visible).toBe(false);
    c.update(still, 0.4); // let go
    expect(c.isAiming).toBe(false);
  });

  it('keeps walking with the legs while the arms aim', () => {
    const { c } = armed();
    c.fired();
    const run = { speed: 4, crouching: false, onGround: true };
    c.update(run, 0.3);
    expect(c.animation).toBe('jog');
    expect(c.isAiming).toBe(true);
  });

  it('ignores a shot when there is no gun, and puts the arms down if the gun is taken away', () => {
    const t = template();
    const c = new GltfCharacter(t.root, clips, look, thresholds);
    c.fired();
    expect(c.isAiming).toBe(false);
    const { c: armedChar } = armed();
    armedChar.fired();
    armedChar.holdItem(undefined);
    expect(armedChar.isAiming).toBe(false);
  });

  it('copes with a rig that has no aim clips', () => {
    const t = template();
    const c = new GltfCharacter(t.root, clips, look, thresholds);
    c.holdItem(new Group());
    expect(() => {
      c.fired();
      c.update(still, 0.5);
    }).not.toThrow();
  });
});

describe('GltfCharacter LOD', () => {
  it('shows the full body near and the light *_LOD copy far, sharing one rig', () => {
    const t = template();
    const lod = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: 'body' }));
    lod.name = 'Body_LOD';
    t.root.add(lod);
    const c = new GltfCharacter(t.root, clips, look, thresholds);
    const near = byName(c, 'MI_Hair_1');
    const far = meshesOf(c).find((m) => m.name === 'Body_LOD');
    expect(near.visible).toBe(true);
    expect(far?.visible).toBe(false);
    c.setFar(true);
    expect(c.isFar).toBe(true);
    expect(near.visible).toBe(false);
    expect(far?.visible).toBe(true);
    // The light body is recoloured like the full one.
    expect((far?.material as MeshStandardMaterial).customProgramCacheKey()).toBe(
      'heist-character-body',
    );
    c.setFar(false);
    expect(near.visible).toBe(true);
  });

  it('ignores the switch for a character file without a light copy', () => {
    const c = new GltfCharacter(template().root, clips, look, thresholds);
    c.setFar(true);
    expect(c.isFar).toBe(false);
    expect(byName(c, 'MI_Hair_1').visible).toBe(true);
  });
});

describe('character files', () => {
  it('carry a light copy of body and hair (tools/characters/build-lod.mjs)', () => {
    for (const file of ['male.glb', 'female.glb']) {
      const glb = readFileSync(join(__dirname, '../../public/characters/', file));
      const jsonLength = glb.readUInt32LE(12);
      const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
        nodes: { name?: string; skin?: number }[];
      };
      const lods = json.nodes.filter((n) => n.name?.endsWith('_LOD'));
      expect(lods.length).toBe(2);
      expect(lods.every((n) => n.skin !== undefined)).toBe(true);
    }
  });
});
