import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Object3D,
} from 'three';

const COLOUR = 0xffd34d;
const HEIGHT = 40;

/**
 * A tall glowing column where the current tutorial step happens, seen from
 * across the yard and through the bank's floors, so a new player always knows
 * where to go next.
 */
export class TutorialBeacon {
  readonly object: Object3D;
  private readonly beam: MeshBasicMaterial;
  private readonly ring: MeshBasicMaterial;

  constructor() {
    const glow = (opacity: number) =>
      new MeshBasicMaterial({
        color: COLOUR,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
      });
    this.beam = glow(0.25);
    // The beam shows through walls and floors (the vault is inside the bank); the ring does not.
    this.beam.depthTest = false;
    this.ring = glow(0.8);
    const column = new Mesh(new CylinderGeometry(0.5, 0.5, HEIGHT, 16, 1, true), this.beam);
    column.position.y = HEIGHT / 2;
    column.renderOrder = 10;
    const floor = new Mesh(new RingGeometry(1.1, 1.4, 32), this.ring);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.05;
    this.object = new Group().add(column, floor);
    this.object.visible = false;
  }

  /** Stands the beacon at `at`, or hides it (steps done anywhere). */
  setTarget(at: { readonly x: number; readonly y: number; readonly z: number } | undefined): void {
    this.object.visible = at !== undefined;
    if (at) this.object.position.set(at.x, at.y, at.z);
  }

  /** A slow pulse, so it reads as "go here" rather than as part of the scenery. */
  update(seconds: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(seconds * 3);
    this.beam.opacity = 0.15 + 0.15 * pulse;
    this.ring.opacity = 0.5 + 0.4 * pulse;
  }
}
