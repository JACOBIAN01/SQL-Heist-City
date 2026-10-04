import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/** Seconds to bring the gun from the sling to the shoulder, and to put it back. */
export const DRAW_SECONDS = 0.3;
export const HOLSTER_SECONDS = 0.45;
/** How far (m) and how much (rad) one shot pushes the gun back and the muzzle up, and how fast that settles (s). */
const RECOIL_BACK = 0.06;
const RECOIL_RISE = 0.07;
const RECOIL_SETTLE = 0.07;
/** Sideways and upward swing (m) halfway through a draw, so the gun travels in an arc rather than through the chest. */
const DRAW_ARC = new Vector3(0.12, 0.1, 0);
/** Behind the shoulder blades (character space: +z is behind, the character faces −z). */
const SLING_OFFSET = new Vector3(0, -0.04, 0.26);
/** The gun hangs with the stock over the right shoulder and the muzzle down at the left hip. */
const SLING_BARREL = new Vector3(-0.5, -1, 0).normalize();
/** Rifles are modelled grip at the origin, muzzle toward −z; this is roughly the middle of one. */
const GUN_MIDDLE = 0.27;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Rotation that points a gun's barrel (its −z) along `barrel`, top of the gun toward `up` where possible. */
function aimRotation(barrel: Vector3, up: Vector3, out: Quaternion): Quaternion {
  const z = barrel.clone().negate();
  const x = new Vector3().crossVectors(up, z).normalize();
  const y = new Vector3().crossVectors(z, x);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Gun lying flat against the back: its side faces away from the body. */
const SLUNG = (() => {
  const z = SLING_BARREL.clone().negate();
  const x = new Vector3(0, 0, 1);
  const y = new Vector3().crossVectors(z, x);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
})();

/**
 * Where the gun is, frame by frame: slung across the back, drawn to the
 * shoulder along an arc, held pointing where the player aims (never back at
 * the camera, whatever the arm animation does), kicked by each shot and
 * settling again. Works in the character's own space, so it does not depend
 * on how the rig's bones are oriented; only the bone *positions* are used.
 * Pattern: State + procedural animation — Why: clips give the body; the gun's
 * direction must follow the aim exactly, which a clip cannot know.
 */
export class GunHandling {
  /** 0 = slung, 1 = at the shoulder. */
  blend = 0;
  private recoil = 0;
  private pitch = 0;
  private readonly hand = new Quaternion();
  private readonly kick = new Quaternion();
  private readonly at = new Vector3();
  private readonly scratch = new Vector3();

  get drawn(): boolean {
    return this.blend >= 0.5;
  }

  /** Up/down aim of the player (radians, positive up). */
  setPitch(pitch: number): void {
    this.pitch = Math.max(-1.2, Math.min(1.2, pitch));
  }

  fire(): void {
    this.recoil = 1;
  }

  update(dtSeconds: number, aiming: boolean): void {
    const rate = aiming ? 1 / DRAW_SECONDS : -1 / HOLSTER_SECONDS;
    this.blend = Math.max(0, Math.min(1, this.blend + rate * dtSeconds));
    this.recoil *= Math.exp(-dtSeconds / RECOIL_SETTLE);
  }

  /**
   * Places `gun` (a child of the character root) between the sling at
   * `back` (upper spine) and the grip at `hand` (right hand), both in character space.
   */
  pose(gun: Object3D, back: Vector3, hand: Vector3): void {
    const t = smooth(this.blend);

    // Slung: centred behind the upper back.
    const slungAt = this.scratch
      .copy(back)
      .add(SLING_OFFSET)
      .addScaledVector(new Vector3(0, 0, 1).applyQuaternion(SLUNG), GUN_MIDDLE);

    // Aimed: grip in the hand, barrel along the aim, stock back toward the shoulder.
    const barrel = new Vector3(0, Math.sin(this.pitch), -Math.cos(this.pitch));
    aimRotation(barrel, new Vector3(0, 1, 0), this.hand);
    this.kick.setFromAxisAngle(new Vector3(1, 0, 0), RECOIL_RISE * this.recoil);
    this.hand.multiply(this.kick);
    const aimedAt = this.at.copy(hand).addScaledVector(barrel, -RECOIL_BACK * this.recoil);

    gun.position.lerpVectors(slungAt, aimedAt, t).addScaledVector(DRAW_ARC, Math.sin(t * Math.PI));
    gun.quaternion.slerpQuaternions(SLUNG, this.hand, t);
  }
}
