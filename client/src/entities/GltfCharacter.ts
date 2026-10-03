import type { AnimationAction } from 'three';
import {
  AnimationMixer,
  Color,
  Group,
  MeshStandardMaterial,
  type AnimationClip,
  type Material,
  type WebGLProgramParametersWithUniforms,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  selectAnimation,
  type AnimationName,
  type AnimationThresholds,
  type MotionState,
} from './animation';
import type { CharacterRig } from './CharacterRig';

/** What makes one player look different from another. */
export interface Look {
  readonly shirt: number;
  readonly trousers: number;
  readonly shoes: number;
  /** Replaces the baked-in (dark) skin texture, e.g. a lighter skin tone. */
  readonly skin?: Texture;
}

/** Which clip in the animation file plays for each state. */
export const CLIP_FOR: Readonly<Record<AnimationName, string>> = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  crouch: 'Crouch_Idle_Loop',
  crouchWalk: 'Crouch_Fwd_Loop',
  air: 'Jump_Loop',
};

/**
 * Ground speed (m/s) each locomotion clip was authored for. Playing a clip
 * faster or slower than that keeps the feet from sliding over the ground.
 */
const NOMINAL_SPEED: Partial<Record<AnimationName, number>> = {
  walk: 1.4,
  jog: 3.6,
  sprint: 5.6,
  crouchWalk: 1.6,
};
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;
const CROSSFADE_SECONDS = 0.15;

/**
 * A rigged human (Quaternius, CC0) driven by shared animation clips.
 * The body arrives as separate skin / shirt / trousers / shoes parts, so each
 * player gets their own recoloured materials without a new model or texture.
 * Pattern: Strategy (CharacterRig) — Why: same interface as the placeholder
 * boxes, so the game logic is untouched by which one is used.
 */
export class GltfCharacter implements CharacterRig {
  readonly object = new Group();
  animation: AnimationName = 'idle';
  private readonly mixer: AnimationMixer;
  private current: AnimationAction | undefined;
  private started = false;
  private readonly actions = new Map<string, AnimationAction>();

  constructor(
    template: Object3D,
    private readonly clips: ReadonlyMap<string, AnimationClip>,
    look: Look,
    private readonly thresholds: AnimationThresholds,
  ) {
    // The model faces +z; the game's "forward" at yaw 0 is −z.
    const model = clone(template);
    model.rotation.y = Math.PI;
    this.object.add(model);
    this.mixer = new AnimationMixer(model);

    const own = new Map<Material, Material>();
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      // Eyes are tiny: skip them in the shadow pass (one draw call less per player).
      mesh.castShadow = !/Eyes/.test((mesh.material as Material).name);
      mesh.frustumCulled = false; // skinned bounds do not follow the animation
      mesh.material = this.styled(mesh.material as Material, look, own);
    });
  }

  update(motion: MotionState, dtSeconds: number): void {
    const next = selectAnimation(motion, this.thresholds);
    if (next !== this.animation || !this.started) this.play(next);
    this.animation = next;
    const nominal = NOMINAL_SPEED[next];
    if (this.current && nominal) {
      this.current.setEffectiveTimeScale(
        Math.min(MAX_SCALE, Math.max(MIN_SCALE, motion.speed / nominal)),
      );
    }
    this.mixer.update(dtSeconds);
  }

  private play(name: AnimationName): void {
    const clip = this.clips.get(CLIP_FOR[name]);
    if (!clip) return;
    let action = this.actions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
    action.setEffectiveTimeScale(1);
    if (this.current && this.current !== action) {
      action.reset().fadeIn(CROSSFADE_SECONDS).play();
      this.current.fadeOut(CROSSFADE_SECONDS);
    } else {
      action.reset().play();
    }
    this.current = action;
    this.started = true;
  }

  /**
   * Per-player copy of the body material. The body is one mesh (one draw call);
   * a per-vertex region code (skin / shirt / trousers / shoes) lets the shader
   * paint each region with this player's colours. Hair and eyes stay shared.
   */
  private styled(material: Material, look: Look, own: Map<Material, Material>): Material {
    if (material.name !== 'body' || !(material instanceof MeshStandardMaterial)) return material;
    let copy = own.get(material);
    if (!copy) {
      const body = material.clone();
      if (look.skin) body.map = look.skin;
      applyClothing(body, look);
      own.set(material, body);
      copy = body;
    }
    return copy;
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

/** Shader hook: recolour vertices by region code. Exported for tests. */
export function applyClothing(material: MeshStandardMaterial, look: Look): void {
  const uniforms = {
    uShirt: { value: new Color(look.shirt) },
    uTrousers: { value: new Color(look.trousers) },
    uShoes: { value: new Color(look.shoes) },
  };
  // All players share one compiled program; only the uniform values differ.
  material.customProgramCacheKey = () => 'heist-character-body';
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float _region;\nvarying float vRegion;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = _region;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vRegion;\nuniform vec3 uShirt;\nuniform vec3 uTrousers;\nuniform vec3 uShoes;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float region = floor(vRegion + 0.5);
        if (region > 0.5) {
          diffuseColor.rgb = region < 1.5 ? uShirt : (region < 2.5 ? uTrousers : uShoes);
        }`,
      );
  };
}
