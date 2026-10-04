import { Box3, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addLighting } from '../render/lighting';
import { computeViewport } from '../render/viewport';
import { loadCityKit } from '../world/city/CityKit';
import { layoutPreview } from '../world/city/kitPreview';

// Standalone page (kit.html): every kit piece laid out on a grid, to check the build by eye.
// ?piece=Name shows one piece close up.
const params = new URLSearchParams(location.search);
const info = document.getElementById('kit-info');
const renderer = new WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(55, 1, 0.1, 600);
const lighting = addLighting(scene);

const kit = await loadCityKit().catch((error: unknown) => {
  if (info) info.textContent = `Kit failed to load: ${String(error)}`;
  throw error;
});
const only = params.get('piece');
const ids = only ? [only] : kit.pieceIds;
const { root } = layoutPreview(kit, ids);
scene.add(root);

// Frame everything from the front-right, a little above.
const bounds = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
const controls = new OrbitControls(camera, renderer.domElement);
const d = bounds.radius * 1.9;
camera.position.copy(bounds.center).add({ x: d * 0.45, y: d * 0.5, z: d * 0.75 });
controls.target.copy(bounds.center);
controls.update();
lighting.sun.target.position.copy(bounds.center);
lighting.sun.position.copy(bounds.center).add({ x: 30, y: 50, z: 40 });

const tris = ids.reduce((sum, id) => sum + kit.info(id).tris, 0);
if (info) info.textContent = `${ids.length} pieces · ${tris} triangles`;

const resize = (): void => {
  const v = computeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.setPixelRatio(v.pixelRatio);
  renderer.setSize(v.width, v.height);
  camera.aspect = v.aspect;
  camera.updateProjectionMatrix();
};
resize();
window.addEventListener('resize', resize);
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
