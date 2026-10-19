import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { MASK_SHAPES, type MaskShape } from '@heist/shared';
import { CharacterModel, PALETTES } from './entities/CharacterModel';
import { loadCharacterAssets, gltfCharacterFactory } from './entities/characterAssets';
import { thresholdsFor } from './entities/animation';

// Development page: both kinds of body, seen from the front, wearing the look in the address.
const params = new URLSearchParams(location.search);
const shape = params.get('mask') as MaskShape | null;
const look = {
  ...(params.get('outfit') ? { outfit: parseInt(params.get('outfit') as string, 16) } : {}),
  ...(shape && MASK_SHAPES.includes(shape)
    ? { mask: { shape, color: parseInt(params.get('maskColor') ?? 'c0392b', 16) } }
    : {}),
};

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 1.2));
const sun = new DirectionalLight(0xffffff, 2);
sun.position.set(2, 4, -4);
scene.add(sun);
const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50);
camera.position.set(0, 1.4, -6.5);
camera.lookAt(0, 1.0, 0);
const zoom = params.get('zoom');
if (zoom) {
  camera.position.set(0, 1.65, -Number(zoom));
  camera.lookAt(0, 1.62, 0);
}

const thresholds = thresholdsFor(4.2, 6.8);
const rigs = [new CharacterModel(PALETTES[0] ?? { shirt: 0, trousers: 0, skin: 0 }, thresholds)];
try {
  const factory = gltfCharacterFactory(await loadCharacterAssets(), thresholds);
  rigs.push(factory(0) as CharacterModel, factory(1) as CharacterModel);
} catch (error) {
  console.warn('glTF characters unavailable', error);
}
rigs.forEach((rig, i) => {
  // A body at yaw 0 faces −z, toward the camera.
  rig.object.rotation.y = 0;
  rig.object.position.x = (i - (rigs.length - 1) / 2) * 1.3;
  rig.setLook?.(look);
  scene.add(rig.object);
});
if (params.has('axes')) {
  // Which way are the head bone's axes? red = +x, green = +y, blue = +z, 0.2 m out.
  for (const rig of rigs.slice(1)) {
    const head = (rig as unknown as { bones: Map<string, Object3D> }).bones.get('Head');
    for (const [axis, color] of [
      ['x', 0xff0000],
      ['y', 0x00ff00],
      ['z', 0x0000ff],
    ] as const) {
      const cube = new Mesh(new BoxGeometry(0.06, 0.06, 0.06), new MeshBasicMaterial({ color }));
      cube.position[axis] = 0.2;
      head?.add(cube);
    }
  }
}
const still = { speed: 0, crouching: false, onGround: true };
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - last) / 1000;
  last = now;
  for (const rig of rigs) rig.update(still, dt);
  renderer.render(scene, camera);
  document.title = 'ready';
});
