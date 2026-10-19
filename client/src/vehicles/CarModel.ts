import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MeshStandardMaterial } from 'three';
import { BufferAttribute, BufferGeometry, Group, Mesh, type Object3D } from 'three';
import type { VehicleState } from '@heist/shared';
import { createBakedColourMaterial } from '../render/bakedColourMaterial';

/** Wheel nodes in the car file are `<car>_<part>` (tools/city/build-cars.mjs); their origins are the axles. */
const FRONT = ['wheel_fl', 'wheel_fr'] as const;
const WHEELS = [...FRONT, 'wheels_back'] as const;

/** One material for every car (see createBakedColourMaterial). */
export function createCarMaterial(nightGlow: { value: number }): MeshStandardMaterial {
  return createBakedColourMaterial({ name: 'car', nightGlow, roughness: 0.55, metalness: 0.1 });
}

/**
 * A copy with fresh, plain attributes: loaded attributes can differ in
 * internal details (interleaving, GPU type) that stop geometries merging.
 */
function plain(source: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as BufferAttribute;
    const array = new (a.array.constructor as new (n: number) => Float32Array | Uint8Array)(
      a.count * a.itemSize,
    );
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < a.itemSize; c++) array[i * a.itemSize + c] = a.getComponent(i, c);
    out.setAttribute(name, new BufferAttribute(array, a.itemSize, a.normalized));
  }
  if (source.index) out.setIndex(Array.from(source.index.array as ArrayLike<number>));
  return out;
}

/** One merged geometry per car model (body and wheels together), shared by every parked copy. */
const stillGeometry = new WeakMap<Object3D, BufferGeometry>();

function mergedGeometry(template: Object3D): BufferGeometry {
  let merged = stillGeometry.get(template);
  if (merged) return merged;
  template.updateMatrixWorld(true);
  const inverse = template.matrixWorld.clone().invert();
  const parts: BufferGeometry[] = [];
  template.traverse((n) => {
    const mesh = n as Mesh;
    if (!mesh.isMesh) return;
    parts.push(plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  merged = mergeGeometries(parts) ?? new BufferGeometry();
  stillGeometry.set(template, merged);
  return merged;
}

/**
 * A drawn car: placed from a VehicleState, front wheels turned by the
 * steering, all wheels rolling with the speed. A car standing still is drawn
 * as one merged mesh (one draw call instead of four), so a street of parked
 * cars stays cheap; it switches to the jointed version as soon as it moves.
 */
export class CarModel {
  readonly object = new Group();
  private readonly wheels: Object3D[] = [];
  private readonly front: Object3D[] = [];
  /** Wheel radius (m), for how fast they spin. */
  private readonly radius: number;
  private readonly jointed: Object3D;
  private readonly still: Mesh;
  private readonly body: Mesh[] = [];
  private readonly base: MeshStandardMaterial;
  private painted: MeshStandardMaterial | undefined;

  constructor(template: Object3D, material: MeshStandardMaterial, wheelRadius = 0.27) {
    const car = template.clone();
    car.position.set(0, 0, 0);
    car.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) {
        this.body.push(mesh);
        mesh.material = material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    for (const name of WHEELS) {
      const wheel = car.getObjectByName(`${template.name}_${name}`);
      if (!wheel) continue;
      // Steer about y first, then roll about the wheel's own axle (x).
      wheel.rotation.order = 'YXZ';
      this.wheels.push(wheel);
      if ((FRONT as readonly string[]).includes(name)) this.front.push(wheel);
    }
    this.radius = wheelRadius;
    this.jointed = car;
    this.still = new Mesh(mergedGeometry(template), material);
    this.still.castShadow = true;
    this.still.receiveShadow = true;
    this.still.name = `${template.name}_still`;
    this.body.push(this.still);
    this.base = material;
    car.visible = false;
    this.object.add(car, this.still);
    this.object.name = `car-${template.name}`;
  }

  /** Paints the car (the colour is a tint over the baked colours); undefined gives back the factory colours. */
  setPaint(material: MeshStandardMaterial | undefined): void {
    if (this.painted === material) return;
    this.painted = material;
    for (const mesh of this.body) mesh.material = material ?? this.base;
  }

  /** Places the car and its wheels; `distance` is how far it moved since the last pose (m, signed). */
  pose(
    state: Pick<VehicleState, 'x' | 'z' | 'yaw' | 'steer'>,
    distance: number,
    moving = distance !== 0,
  ): void {
    this.object.position.set(state.x, 0, state.z);
    this.object.rotation.y = state.yaw;
    this.jointed.visible = moving;
    this.still.visible = !moving;
    if (!moving) return;
    for (const w of this.front) w.rotation.y = state.steer;
    // Rolling forward (−z) turns the wheel's top toward −z: negative about x.
    for (const w of this.wheels) w.rotation.x -= distance / this.radius;
  }

  /** True while the jointed (moving) version is drawn. For tests. */
  get isMoving(): boolean {
    return this.jointed.visible;
  }

  /** For tests. */
  get wheelCount(): number {
    return this.wheels.length;
  }
}
