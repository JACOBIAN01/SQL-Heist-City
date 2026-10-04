import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { createCashBag } from './CashBag';

/** Carried bags are a little smaller than ones on the floor (which are scaled up to be seen). */
const SCALE = 0.7;
/** Top of the handle above the bag's bottom, at that scale. */
const HANDLE_TOP = 0.43 * SCALE;
/** Hand-carried: the handle sits in the fist, the bag a hand's width out from the leg. */
const IN_HAND = new Vector3(-0.04, -0.02, 0);
/** Strap-carried (while aiming): at the left hip, a little behind, clear of the thigh and the slung gun. */
const AT_HIP = new Vector3(-0.3, -0.08, 0.1);
/** Where the strap goes over the left shoulder, relative to the upper spine. */
const SHOULDER = new Vector3(-0.16, 0.13, 0.03);

const STRAP_MATERIAL = new MeshStandardMaterial({ color: 0x15181a, roughness: 0.8 });
const STRAP = new BoxGeometry(0.035, 1, 0.012);
const UP = new Vector3(0, 1, 0);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * The cash duffel a player carries, posed each frame from where the body is:
 * swinging from the left hand while walking, and hitched onto a shoulder
 * strap at the left hip while the hands are on the gun. Left side only, so it
 * never meets the rifle slung across the back. Character space (+z behind,
 * −x left), bone positions only, like GunHandling.
 */
export class CarriedBag {
  readonly object = new Group();
  private readonly bag = createCashBag();
  private readonly strap = new Mesh(STRAP, STRAP_MATERIAL);
  private readonly top = new Vector3();
  private readonly mid = new Vector3();
  private readonly dir = new Vector3();
  private readonly turn = new Quaternion();

  constructor() {
    this.bag.scale.setScalar(SCALE);
    // Long side front-to-back, so it hangs alongside the leg instead of across it.
    this.bag.rotation.y = Math.PI / 2;
    this.object.add(this.bag, this.strap);
    this.object.name = 'carried-bag';
    this.object.visible = false;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  set visible(on: boolean) {
    this.object.visible = on;
  }

  /**
   * `hand` (left hand), `hip` (pelvis) and `spine` (upper spine) in character
   * space; `strapped` 0 = carried by hand, 1 = on the shoulder strap.
   */
  pose(hand: Vector3, hip: Vector3, spine: Vector3, strapped: number): void {
    const t = smooth(Math.max(0, Math.min(1, strapped)));
    // Where the top of the handle is, then the bag hangs straight down from it.
    this.top.copy(hand).add(IN_HAND);
    this.mid
      .copy(hip)
      .add(AT_HIP)
      .setY(hip.y + AT_HIP.y + HANDLE_TOP);
    this.top.lerp(this.mid, t);
    this.bag.position.set(this.top.x, this.top.y - HANDLE_TOP, this.top.z);

    // The strap runs from the bag up to the shoulder, shown once the bag is on it.
    this.strap.visible = t > 0.5;
    if (!this.strap.visible) return;
    const shoulder = this.mid.copy(spine).add(SHOULDER);
    this.dir.subVectors(shoulder, this.top);
    const length = this.dir.length();
    this.strap.position.copy(this.top).addScaledVector(this.dir, 0.5);
    this.strap.scale.set(1, length, 1);
    this.strap.quaternion.copy(this.turn.setFromUnitVectors(UP, this.dir.normalize()));
  }
}
