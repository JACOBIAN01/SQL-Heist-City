import type { AnimationAction } from 'three';
import {
  AnimationMixer,
  LoopOnce,
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
import { splitClip } from './aimLayers';
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

/** How long a soldier stays at the ready after the last shot before lowering the gun. */
const AIM_HOLD_SECONDS = 1.4;
const DRAW_FADE_SECONDS = 0.2;
const LOWER_FADE_SECONDS = 0.3;
/** The gun changes hands at the middle of the draw, and goes back to the sling once the arms are down. */
const DRAW_SWAP_SECONDS = 0.1;
const HOLSTER_SWAP_SECONDS = 0.28;
/** The recoil clip is blended over the aim pose with extra weight so it reads as a kick, not a 50/50 mix. */
const KICK_WEIGHT = 4;

/** Where the gun sits in each bone's own space: slung across the back, and held at the ready. */
export const GUN_ON_BACK = {
  bone: 'spine_03',
  position: [0, 0.1, -0.14],
  rotation: [1.57, 0, 0.3],
} as const;
/** Debug: overrides for the in-hand pose, set from the URL while tuning (?grot=x,y,z&gpos=x,y,z). */
export const gunTuning: {
  rotation?: [number, number, number];
  position?: [number, number, number];
  backRotation?: [number, number, number];
  backPosition?: [number, number, number];
} = {};

export const GUN_IN_HAND = {
  bone: 'hand_r',
  position: [0, 0.05, 0],
  rotation: [-1.57, 0, 0],
} as const;

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
  private readonly splits = new Map<string, ReturnType<typeof splitClip>>();

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
    model.traverse((n) => {
      if (n.name) this.bones.set(n.name, n);
    });
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

  private held: Object3D | undefined;
  private readonly bones = new Map<string, Object3D>();
  private aimIdle: AnimationAction | undefined;
  private kick: AnimationAction | undefined;
  private aiming = false;
  private aimTimer = 0;
  /** Where the gun is going and when (seconds from now), so the swap lands mid-draw. */
  private pending: { slot: 'back' | 'hand'; in: number } | undefined;
  private gunSlot: 'back' | 'hand' = 'back';

  /** True while the gun is drawn (for tests and debugging). */
  get isAiming(): boolean {
    return this.aiming;
  }

  get gunIn(): 'back' | 'hand' {
    return this.gunSlot;
  }

  holdItem(item: Object3D | undefined): void {
    this.held?.removeFromParent();
    this.held = item;
    if (!item) {
      if (this.aiming) this.setAiming(false);
      this.pending = undefined;
      return;
    }
    this.place(this.aiming ? 'hand' : 'back');
  }

  /** The player just fired: draw the gun if it is slung, aim, and kick. Does nothing without a gun. */
  fired(): void {
    if (!this.held) return;
    this.aimTimer = AIM_HOLD_SECONDS;
    if (!this.aiming) this.setAiming(true);
    if (!this.kick) {
      this.kick = this.upperAction('Pistol_Shoot');
      this.kick?.setLoop(LoopOnce, 1);
    }
    this.kick?.reset().setEffectiveWeight(KICK_WEIGHT).play();
  }

  private setAiming(on: boolean): void {
    if (on === this.aiming) return;
    this.aiming = on;
    // Legs keep their locomotion; arms and torso come from (or leave) the aiming clip.
    this.play(this.animation);
    this.aimIdle ??= this.upperAction('Pistol_Idle_Loop');
    if (on) this.aimIdle?.reset().fadeIn(DRAW_FADE_SECONDS).play();
    else this.aimIdle?.fadeOut(LOWER_FADE_SECONDS);
    this.pending = on
      ? { slot: 'hand', in: DRAW_SWAP_SECONDS }
      : { slot: 'back', in: HOLSTER_SWAP_SECONDS };
  }

  /** An action that plays only the upper-body tracks of a clip; undefined if the clip is missing. */
  private upperAction(clipName: string): AnimationAction | undefined {
    const clip = this.clips.get(clipName);
    return clip ? this.mixer.clipAction(this.splitOf(clip).upper) : undefined;
  }

  private splitOf(clip: AnimationClip) {
    let pair = this.splits.get(clip.name);
    if (!pair) this.splits.set(clip.name, (pair = splitClip(clip)));
    return pair;
  }

  private place(slot: 'back' | 'hand'): void {
    const item = this.held;
    if (!item) return;
    const spec = slot === 'hand' ? GUN_IN_HAND : GUN_ON_BACK;
    const bone = this.bones.get(spec.bone) ?? this.object;
    const pos = (slot === 'hand' ? gunTuning.position : gunTuning.backPosition) || spec.position;
    const rot = (slot === 'hand' ? gunTuning.rotation : gunTuning.backRotation) || spec.rotation;
    item.position.fromArray(pos);
    item.rotation.set(rot[0], rot[1], rot[2]);
    bone.add(item);
    this.gunSlot = slot;
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
    if (this.aiming) {
      this.aimTimer -= dtSeconds;
      if (this.aimTimer <= 0) this.setAiming(false);
    }
    if (this.pending) {
      this.pending.in -= dtSeconds;
      if (this.pending.in <= 0) {
        this.place(this.pending.slot);
        this.pending = undefined;
      }
    }
    this.mixer.update(dtSeconds);
  }

  private play(name: AnimationName): void {
    const full = this.clips.get(CLIP_FOR[name]);
    if (!full) return;
    // While aiming only the legs come from locomotion; the aim clip owns the upper body.
    const clip = this.aiming ? this.splitOf(full).lower : full;
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
