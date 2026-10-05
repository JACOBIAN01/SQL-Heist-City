import {
  Group,
  MeshStandardMaterial,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { VehicleState } from '@heist/shared';

/** Wheel nodes in the car file are `<car>_<part>` (tools/city/build-cars.mjs); their origins are the axles. */
const FRONT = ['wheel_fl', 'wheel_fr'] as const;
const WHEELS = [...FRONT, 'wheels_back'] as const;

/**
 * One material for every car: colours are in the vertices, faces are flat
 * (the file stores no normals), and lamp vertices (_glow) light up at night.
 * Pattern: Flyweight — Why: a street full of cars is one compiled program
 * and one material; only transforms differ.
 */
export function createCarMaterial(nightGlow: { value: number }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name: 'car',
    vertexColors: true,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.1,
  });
  material.customProgramCacheKey = () => 'heist-car';
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uNightGlow = nightGlow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float _glow;\nvarying float vGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = _glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uNightGlow;\nvarying float vGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        // Lamps glow a little by day and properly at night (bloom catches them).
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * (0.2 + 2.5 * uNightGlow);',
      );
  };
  return material;
}

/**
 * A drawn car: placed from a VehicleState, front wheels turned by the
 * steering, all wheels rolling with the speed.
 */
export class CarModel {
  readonly object = new Group();
  private readonly wheels: Object3D[] = [];
  private readonly front: Object3D[] = [];
  /** Wheel radius (m), for how fast they spin. */
  private readonly radius: number;

  constructor(template: Object3D, material: MeshStandardMaterial, wheelRadius = 0.27) {
    const car = template.clone();
    car.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) {
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
    this.object.add(car);
    this.object.name = `car-${template.name}`;
  }

  /** Places the car and its wheels; `distance` is how far it moved since the last pose (m, signed). */
  pose(state: Pick<VehicleState, 'x' | 'z' | 'yaw' | 'steer'>, distance: number): void {
    this.object.position.set(state.x, 0, state.z);
    this.object.rotation.y = state.yaw;
    for (const w of this.front) w.rotation.y = state.steer;
    // Rolling forward (−z) turns the wheel's top toward −z: negative about x.
    for (const w of this.wheels) w.rotation.x -= distance / this.radius;
  }

  /** For tests. */
  get wheelCount(): number {
    return this.wheels.length;
  }
}
