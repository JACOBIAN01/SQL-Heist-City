import type { AnimationAction } from 'three';
import {
  AnimationMixer,
  Vector3,
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
import { CarriedBag } from './CarriedBag';
import { GunHandling } from './GunHandling';
import type { CharacterRig } from './CharacterRig';

/** What makes one player look different from another. */
export interface Look {
  readonly shirt: number;
  readonly trousers: number;
  readonly shoes: number;
  /** Replaces the baked-in (dark) skin texture, e.g. a lighter skin tone. */
  readonly skin?: Texture;
}

/** Name suffix of the light, far-distance meshes in a character file (tools/characters/build-lod.mjs). */
export const LOD_SUFFIX = '_LOD';

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
const AIM_HOLD_SECONDS = 2;
/** After the aim button is let go, the gun stays up this long. */
const RAISE_HOLD_SECONDS = 0.3;
/** Arms come up a little faster than the gun travels, so the hands meet it. */
const DRAW_FADE_SECONDS = 0.25;
const LOWER_FADE_SECONDS = 0.4;
/** A muzzle flash lasts about one frame at 30 fps: long enough to see, short enough not to linger. */
const FLASH_SECONDS = 0.04;
/** Where the bones are when the rig has none (the test stand-ins): upper back and right hand at the ready. */
const FALLBACK_BACK = new Vector3(0, 1.4, 0.05);
const FALLBACK_HAND = new Vector3(0.15, 1.45, -0.4);
const FALLBACK_LEFT_HAND = new Vector3(-0.3, 0.85, 0);
const FALLBACK_HIP = new Vector3(0, 0.95, 0);

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
    this.object.add(this.bag.object);
    model.traverse((n) => {
      if (n.name) this.bones.set(n.name, n);
    });
    this.mixer = new AnimationMixer(model);

    const own = new Map<Material, Material>();
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      // The character file carries a light copy of body and hair (`*_LOD`), skinned to the same skeleton.
      if (mesh.name.endsWith(LOD_SUFFIX)) {
        this.farMeshes.push(mesh);
        mesh.visible = false;
      } else this.nearMeshes.push(mesh);
      // Eyes are tiny: skip them in the shadow pass (one draw call less per player).
      mesh.castShadow = !/Eyes/.test((mesh.material as Material).name);
      mesh.frustumCulled = false; // skinned bounds do not follow the animation
      mesh.material = this.styled(mesh.material as Material, look, own);
    });
  }

  private held: Object3D | undefined;
  private readonly nearMeshes: Object3D[] = [];
  private readonly farMeshes: Object3D[] = [];
  private far = false;
  private readonly bones = new Map<string, Object3D>();
  private aimIdle: AnimationAction | undefined;
  private aiming = false;
  private aimTimer = 0;
  private readonly gun = new GunHandling();
  private flashLeft = 0;
  private readonly backAt = new Vector3();
  private readonly bag = new CarriedBag();
  private readonly leftHandAt = new Vector3();
  private readonly hipAt = new Vector3();
  private readonly handAt = new Vector3();

  /** True while the soldier is at the ready (for tests and debugging). */
  get isAiming(): boolean {
    return this.aiming;
  }

  /** Where the gun is: on the sling or at the shoulder (half-way through a draw counts as the hand). */
  get gunIn(): 'back' | 'hand' {
    return this.gun.drawn ? 'hand' : 'back';
  }

  holdItem(item: Object3D | undefined): void {
    this.held?.removeFromParent();
    this.held = item;
    if (!item) {
      if (this.aiming) this.setAiming(false);
      return;
    }
    // The gun is placed in character space every frame (see GunHandling), not parented to a bone.
    this.object.add(item);
    this.poseGun();
  }

  setCarrying(carrying: boolean): void {
    this.bag.visible = carrying;
    if (carrying) this.poseGun();
  }

  /** For tests and debugging. */
  get carriedBag(): CarriedBag {
    return this.bag;
  }

  setAimPitch(pitch: number): void {
    this.gun.setPitch(pitch);
  }

  /** Swaps to the light body (~1.5k triangles instead of ~5k) far away; no-op for files without one. */
  setFar(far: boolean): void {
    if (far === this.far || this.farMeshes.length === 0) return;
    this.far = far;
    for (const m of this.nearMeshes) m.visible = !far;
    for (const m of this.farMeshes) m.visible = far;
  }

  /** Whether the light body is showing (for tests and debugging). */
  get isFar(): boolean {
    return this.far;
  }

  /** The player just fired: draw the gun if it is slung, bring it up, and take the recoil. */
  fired(): void {
    if (!this.held) return;
    this.aimTimer = AIM_HOLD_SECONDS;
    if (!this.aiming) this.setAiming(true);
    this.gun.fire();
    this.flashLeft = FLASH_SECONDS;
  }

  /** Aim button held: the gun comes up and stays up a moment after it is let go. */
  raise(): void {
    if (!this.held) return;
    this.aimTimer = Math.max(this.aimTimer, RAISE_HOLD_SECONDS);
    if (!this.aiming) this.setAiming(true);
  }

  private setAiming(on: boolean): void {
    if (on === this.aiming) return;
    this.aiming = on;
    // Legs keep their locomotion; arms and torso come from (or leave) the aiming clip.
    this.play(this.animation);
    this.aimIdle ??= this.upperAction('Pistol_Idle_Loop');
    if (on) this.aimIdle?.reset().fadeIn(DRAW_FADE_SECONDS).play();
    else this.aimIdle?.fadeOut(LOWER_FADE_SECONDS);
  }

  /** Puts the gun where GunHandling says, using where the upper back and right hand are this frame. */
  private poseGun(): void {
    const item = this.held;
    if (!item && !this.bag.visible) return;
    const spine = this.bones.get('spine_03');
    const hand = this.bones.get('hand_r');
    const leftHand = this.bones.get('hand_l');
    const pelvis = this.bones.get('pelvis');
    if (spine && hand && leftHand && pelvis) {
      this.object.updateWorldMatrix(true, true);
      this.object.worldToLocal(spine.getWorldPosition(this.backAt));
      this.object.worldToLocal(hand.getWorldPosition(this.handAt));
      this.object.worldToLocal(leftHand.getWorldPosition(this.leftHandAt));
      this.object.worldToLocal(pelvis.getWorldPosition(this.hipAt));
    } else {
      this.backAt.copy(FALLBACK_BACK);
      this.handAt.copy(FALLBACK_HAND);
      this.leftHandAt.copy(FALLBACK_LEFT_HAND);
      this.hipAt.copy(FALLBACK_HIP);
    }
    if (item) this.gun.pose(item, this.backAt, this.handAt);
    // Hands on the gun: the bag goes onto its strap; otherwise it swings from the left hand.
    if (this.bag.visible)
      this.bag.pose(this.leftHandAt, this.hipAt, this.backAt, item ? this.gun.blend * 2 : 0);
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
    this.gun.update(dtSeconds, this.aiming);
    this.flashLeft = Math.max(0, this.flashLeft - dtSeconds);
    const flash = this.held?.getObjectByName('muzzle-flash');
    // Only once the gun is up: a flash from the sling would be wrong.
    if (flash) flash.visible = this.flashLeft > 0 && this.gun.drawn;
    this.mixer.update(dtSeconds);
    this.poseGun();
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
