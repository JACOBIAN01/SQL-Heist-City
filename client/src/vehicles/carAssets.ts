import type { MeshStandardMaterial, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VehicleKind } from '@heist/shared';
import { CarModel, createCarMaterial } from './CarModel';

/** Which driving spec each car model uses (art → gameplay kind; the numbers live in VehicleSettings). */
export const CAR_KIND: Readonly<Record<string, VehicleKind>> = {
  NormalCar1: 'sedan',
  NormalCar2: 'sedan',
  Taxi: 'sedan',
  Cop: 'sedan',
  SportsCar: 'sports',
  SportsCar2: 'sports',
  SUV: 'suv',
};

export interface CarAssets {
  readonly templates: ReadonlyMap<string, Object3D>;
  readonly material: MeshStandardMaterial;
  /** 0 by day … 1 at night: lamps glow (set from the sky). */
  readonly nightGlow: { value: number };
  create(id: string): CarModel;
}

/** Wraps loaded car templates (the children of the cars.glb scene) as a factory. Exported for tests. */
export function carAssetsFrom(scene: Object3D): CarAssets {
  const templates = new Map(scene.children.map((c) => [c.name, c] as const));
  const nightGlow = { value: 0 };
  const material = createCarMaterial(nightGlow);
  return {
    templates,
    material,
    nightGlow,
    create(id) {
      const template = templates.get(id);
      if (!template) throw new Error(`no car model ${id}`);
      return new CarModel(template, material);
    },
  };
}

/** Downloads the cars (~380 kB, seven models, one material). */
export async function loadCarAssets(baseUrl = '/vehicles/'): Promise<CarAssets> {
  const gltf = await new GLTFLoader().loadAsync(`${baseUrl}cars.glb`);
  return carAssetsFrom(gltf.scene);
}
