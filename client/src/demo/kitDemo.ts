import { Box3, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addLighting } from '../render/lighting';
import { skyAt } from '../render/dayNight';
import { setNightGlow } from '../world/city/kitMaterials';
import { computeViewport } from '../render/viewport';
import { BANK_LAYOUTS, mapById } from '@heist/shared';
import { loadCityKit } from '../world/city/CityKit';
import { createCityArt, DEFAULT_STREAM } from '../world/city/CityRenderer';
import { layoutPreview } from '../world/city/kitPreview';

// Standalone page (kit.html): every kit piece laid out on a grid, to check the build by eye.
// ?piece=Name shows one piece close up; ?city[=seed] draws the whole city (?lod: as streamed
// from the centre), ?block=ix,iz one block of it.
const params = new URLSearchParams(location.search);
const info = document.getElementById('kit-info');
const renderer = new WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(55, 1, 0.1, 1200);
const lighting = addLighting(scene);
// ?hour=21 shows the kit at that time of day (lit windows glow at night).
lighting.apply(skyAt(Number(params.get('hour') ?? 11)));

const kit = await loadCityKit().catch((error: unknown) => {
  if (info) info.textContent = `Kit failed to load: ${String(error)}`;
  throw error;
});
const only = params.get('piece');
const ids = only ? [only] : kit.pieceIds;
const block = params.get('block');
const citySeed = params.get('city');
const cityLayout =
  params.has('city') || block ? mapById(citySeed ? `city:${citySeed}` : 'city')?.city : undefined;
let summary: string;
let root;
if (cityLayout) {
  // ?lod shows the city as the game streams it from the centre; otherwise everything in detail.
  const lod = params.has('lod');
  const art = createCityArt(kit, cityLayout, BANK_LAYOUTS, {
    ...DEFAULT_STREAM,
    ...(lod ? {} : { detailRange: Infinity, detailExit: Infinity, drawRange: Infinity }),
  });
  art.prime(0, 0);
  root = art.root;
  if (block) {
    const keep = `chunk-${block.replace(',', '-')}`;
    for (const chunk of [...root.children]) if (chunk.name !== keep) root.remove(chunk);
  }
  const st = art.stats;
  summary = `${st.chunks} chunks · ${st.detailed} detailed · ${st.impostors} impostors · ${st.drawCalls} draw calls`;
} else {
  root = layoutPreview(kit, ids).root;
  summary = `${ids.length} pieces · ${ids.reduce((sum, id) => sum + kit.info(id).tris, 0)} triangles`;
}
scene.add(root);
setNightGlow(kit.materials, lighting.state.night);
// The game's fog (60–170 m) would hide an overview framed from hundreds of metres away.
if (cityLayout && !block) scene.fog = null;

// Frame everything from the front-right, a little above.
const bounds = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
const controls = new OrbitControls(camera, renderer.domElement);
const d = bounds.radius * 1.9;
camera.position.copy(bounds.center).add({ x: d * 0.45, y: d * 0.5, z: d * 0.75 });
controls.target.copy(bounds.center);
controls.update();
lighting.sun.target.position.copy(bounds.center);
lighting.sun.position.copy(bounds.center).add({ x: 30, y: 50, z: 40 });

if (info) info.textContent = summary;

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
  lighting.frame(camera);
  renderer.render(scene, camera);
});
