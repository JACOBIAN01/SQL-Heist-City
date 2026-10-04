import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  BoxGeometry,
} from 'three';

// Shared by every bag in the scene: hundreds of carried bags cost no extra memory.
const CANVAS = new MeshStandardMaterial({ color: 0x2d3b2f, roughness: 0.95 });
const STRAP = new MeshStandardMaterial({ color: 0x15181a, roughness: 0.8 });
const METAL = new MeshStandardMaterial({ color: 0xb8a24a, roughness: 0.4, metalness: 0.7 });

// A duffel lies on its side: a rounded barrel (capsule) along x.
const BARREL = new CapsuleGeometry(0.17, 0.42, 6, 14);
const BELT = new TorusGeometry(0.175, 0.02, 6, 16);
const HANDLE = new TorusGeometry(0.09, 0.014, 6, 12, Math.PI);
const ZIP = new BoxGeometry(0.46, 0.012, 0.03);
const LOGO = new CylinderGeometry(0.05, 0.05, 0.01, 14);

/**
 * A duffel bag with two straps, a carry handle, a zip and a gold badge.
 * Built from a few shared primitives (a real model would cost a download for
 * a prop that is mostly seen small and from behind). Origin is the bottom
 * centre; it is about 0.8 m long.
 */
export function createCashBag(): Group {
  const bag = new Group();
  const barrel = new Mesh(BARREL, CANVAS);
  barrel.rotation.z = Math.PI / 2; // capsule axis along x
  barrel.position.y = 0.17;
  bag.add(barrel);

  for (const x of [-0.17, 0.17]) {
    const belt = new Mesh(BELT, STRAP);
    belt.rotation.y = Math.PI / 2;
    belt.position.set(x, 0.17, 0);
    belt.scale.set(1.04, 1.04, 1);
    bag.add(belt);
  }

  const handle = new Mesh(HANDLE, STRAP);
  handle.position.set(0, 0.335, 0);
  handle.rotation.set(0, 0, 0);
  handle.scale.set(2, 1, 1);
  bag.add(handle);

  const zip = new Mesh(ZIP, METAL);
  zip.position.set(0, 0.343, 0);
  bag.add(zip);

  const badge = new Mesh(LOGO, METAL);
  badge.rotation.x = Math.PI / 2;
  badge.position.set(0, 0.17, 0.172);
  bag.add(badge);
  return bag;
}
