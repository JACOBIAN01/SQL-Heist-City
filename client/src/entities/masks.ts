import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';
import type { MaskShape } from '@heist/shared';

/** The head is about 0.26 m across (CharacterModel's box); masks are sized to it and sit at its centre, facing −z. */
const HEAD = 0.26;

const geometries = new Map<string, BufferGeometry>();
const shared = (key: string, make: () => BufferGeometry): BufferGeometry => {
  let g = geometries.get(key);
  if (!g) {
    g = make();
    geometries.set(key, g);
  }
  return g;
};

/**
 * A mask as a few boxes, in head space (origin at the head's centre, facing −z). One small group
 * per wearer; the geometry is shared. Pattern: Factory — Why: a rig only says "put this mask on";
 * the shapes live here, so a new shape is one case in one place.
 */
export function createMask(shape: MaskShape, color: number): Object3D {
  const material = new MeshStandardMaterial({ color, roughness: 0.8 });
  const part = (key: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(
      shared(key, () => new BoxGeometry(w, h, d)),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    return mesh;
  };
  const group = new Group();
  group.name = `mask-${shape}`;
  const e = 0.012; // sits just outside the skin
  switch (shape) {
    case 'bandana':
      group.add(part('bandana', HEAD + 2 * e, HEAD * 0.4, HEAD + 2 * e, 0, -HEAD * 0.28, 0));
      break;
    case 'visor':
      group.add(part('visor', HEAD + 2 * e, HEAD * 0.22, 0.05, 0, HEAD * 0.08, -HEAD / 2 - 0.01));
      break;
    case 'balaclava':
      // A little deeper than the head, so a real nose does not poke through the front.
      group.add(part('balaclava', HEAD + 2 * e, HEAD + 2 * e, HEAD + 0.07, 0, 0, -0.03));
      break;
    case 'clown': {
      group.add(part('clown-plate', HEAD * 0.95, HEAD * 0.9, 0.025, 0, 0, -HEAD / 2 - 0.012));
      const nose = new Mesh(
        shared('clown-nose', () => new SphereGeometry(0.036, 8, 6)),
        new MeshStandardMaterial({ color: 0xd62d20, roughness: 0.6 }),
      );
      nose.position.set(0, -0.01, -HEAD / 2 - 0.04);
      group.add(nose);
      break;
    }
  }
  return group;
}
