import { createCashBag } from './CashBag';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import {
  selectAnimation,
  type AnimationName,
  type AnimationThresholds,
  type MotionState,
} from './animation';
import type { CharacterRig } from './CharacterRig';

export interface CharacterPalette {
  readonly shirt: number;
  readonly trousers: number;
  readonly skin: number;
}

/** Hand-picked so players are told apart at a glance; remote players cycle through these. */
export const PALETTES: readonly CharacterPalette[] = [
  { shirt: 0xc0392b, trousers: 0x2c3e50, skin: 0xe0b48a },
  { shirt: 0x2980b9, trousers: 0x34495e, skin: 0xc68642 },
  { shirt: 0x27ae60, trousers: 0x3b3b3b, skin: 0x8d5524 },
  { shirt: 0x8e44ad, trousers: 0x2c2c2c, skin: 0xf1c27d },
  { shirt: 0xd4a017, trousers: 0x1f2a44, skin: 0xe0b48a },
  { shirt: 0xecf0f1, trousers: 0x4a3b2a, skin: 0xa86b3c },
];

// Shared geometry: every character reuses the same six boxes.
const TORSO = new BoxGeometry(0.5, 0.62, 0.28);
const HEAD = new BoxGeometry(0.26, 0.28, 0.26);
const LIMB_ARM = new BoxGeometry(0.14, 0.58, 0.14).translate(0, -0.27, 0);
const LIMB_LEG = new BoxGeometry(0.18, 0.84, 0.18).translate(0, -0.42, 0);

const STRIDE_METRES = 1.5;
const TAU = Math.PI * 2;

interface Pose {
  /** Radians; positive swings the limb forward. */
  armSwing: number;
  legSwing: number;
  /** Extra arm raise (jump). */
  armLift: number;
  /** Lowers the whole body (crouch), m. */
  drop: number;
  /** Forward lean of the torso, radians. */
  lean: number;
}

/**
 * A ~12-triangle-per-limb blocky student, built procedurally so the game ships
 * no model files yet. Origin at the feet, facing −z (same convention as yaw 0).
 * Animation is a pure function of motion state + a stride phase that advances
 * with distance walked, so feet never skate (Phase 9 swaps in a skinned glTF
 * behind the same `update` interface).
 */
export class CharacterModel implements CharacterRig {
  readonly root = new Group();
  /** Exposed so tests (and later hit-box debugging) can read the pose. */
  readonly body = new Group();
  private readonly torso: Mesh;
  private readonly head: Mesh;
  readonly armL = new Group();
  readonly armR = new Group();
  readonly legL = new Group();
  readonly legR = new Group();
  private phase = 0;
  private breath = 0;
  /** Current clip, exposed for tests and HUD debugging. */
  animation: AnimationName = 'idle';

  constructor(
    palette: CharacterPalette,
    private readonly thresholds: AnimationThresholds,
  ) {
    const shirt = new MeshStandardMaterial({ color: palette.shirt, roughness: 0.9 });
    const trousers = new MeshStandardMaterial({ color: palette.trousers, roughness: 0.9 });
    const skin = new MeshStandardMaterial({ color: palette.skin, roughness: 0.8 });

    this.torso = new Mesh(TORSO, shirt);
    this.torso.position.y = 1.16;
    this.head = new Mesh(HEAD, skin);
    this.head.position.y = 1.62;
    for (const [group, material, x, y] of [
      [this.armL, shirt, -0.33, 1.44],
      [this.armR, shirt, 0.33, 1.44],
      [this.legL, trousers, -0.13, 0.84],
      [this.legR, trousers, 0.13, 0.84],
    ] as const) {
      group.position.set(x, y, 0);
      group.add(
        new Mesh(group === this.armL || group === this.armR ? LIMB_ARM : LIMB_LEG, material),
      );
    }
    this.body.add(this.torso, this.head, this.armL, this.armR, this.legL, this.legR);
    for (const mesh of [
      this.torso,
      this.head,
      ...this.armL.children,
      ...this.armR.children,
      ...this.legL.children,
      ...this.legR.children,
    ]) {
      mesh.castShadow = true;
    }
    this.root.add(this.body);
  }

  get object(): Object3D {
    return this.root;
  }

  private held: Object3D | undefined;

  fired(): void {}

  private bag: Object3D | undefined;

  setCarrying(carrying: boolean): void {
    let bag = this.bag;
    if (!bag) {
      bag = createCashBag();
      bag.scale.setScalar(0.7);
      bag.rotation.y = Math.PI / 2;
      bag.position.set(-0.38, 0.55, 0.05); // at the left hip
      this.root.add(bag);
      this.bag = bag;
    }
    bag.visible = carrying;
  }

  setAimPitch(_pitch: number): void {}

  holdItem(item: Object3D | undefined): void {
    this.held?.removeFromParent();
    this.held = item;
    if (!item) return;
    item.position.set(0.2, 1.2, -0.3);
    item.rotation.set(0, 0, 0);
    this.root.add(item);
  }

  update(motion: MotionState, dtSeconds: number): void {
    this.animation = selectAnimation(motion, this.thresholds);
    this.phase = (this.phase + (motion.speed * dtSeconds * TAU) / STRIDE_METRES) % TAU;
    this.breath = (this.breath + dtSeconds * 2) % TAU;
    this.apply(this.poseFor(this.animation, motion.speed));
  }

  private poseFor(animation: AnimationName, speed: number): Pose {
    const swing = Math.sin(this.phase);
    switch (animation) {
      case 'walk':
      case 'jog':
        return { armSwing: -swing * 0.6, legSwing: swing * 0.7, armLift: 0, drop: 0, lean: 0.04 };
      case 'sprint':
        return { armSwing: -swing * 1.0, legSwing: swing * 1.1, armLift: 0, drop: 0.03, lean: 0.2 };
      case 'crouch':
        return { armSwing: 0, legSwing: 0, armLift: 0, drop: 0.35, lean: 0.25 };
      case 'crouchWalk':
        return {
          armSwing: -swing * 0.3,
          legSwing: swing * 0.45,
          armLift: 0,
          drop: 0.35,
          lean: 0.25,
        };
      case 'air':
        return { armSwing: 0, legSwing: 0.5, armLift: 0.9, drop: 0, lean: speed > 1 ? 0.1 : 0 };
      case 'idle':
        return {
          armSwing: Math.sin(this.breath) * 0.04,
          legSwing: 0,
          armLift: 0,
          drop: 0,
          lean: 0,
        };
    }
  }

  private apply(pose: Pose): void {
    this.body.position.y = -pose.drop;
    this.body.rotation.x = -pose.lean;
    this.armL.rotation.x = -pose.armSwing - pose.armLift;
    this.armR.rotation.x = pose.armSwing - pose.armLift;
    this.legL.rotation.x = -pose.legSwing;
    this.legR.rotation.x = pose.legSwing;
  }
}
