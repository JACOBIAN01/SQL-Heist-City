import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { TEST_MAP } from '@heist/shared';
import { FrameStats } from './render/FrameStats';
import { addLighting } from './render/lighting';
import { computeViewport } from './render/viewport';
import { buildMapObject } from './world/MapRenderer';

// Composition root for the client.
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const lighting = addLighting(scene);
scene.add(buildMapObject(TEST_MAP));

const camera = new PerspectiveCamera(70, 1, 0.1, 220);
const resize = (): void => {
  const v = computeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.setPixelRatio(v.pixelRatio);
  renderer.setSize(v.width, v.height);
  camera.aspect = v.aspect;
  camera.updateProjectionMatrix();
};
resize();
window.addEventListener('resize', resize);

const stats = new FrameStats();
const overlay = document.createElement('div');
overlay.style.cssText =
  'position:fixed;left:8px;top:8px;font:12px ui-monospace,monospace;color:#fff;background:#0008;padding:4px 8px;border-radius:4px;pointer-events:none';
document.body.appendChild(overlay);

let last = performance.now();
let lastOverlay = 0;
renderer.setAnimationLoop((now) => {
  stats.push(now - last);
  last = now;
  // 5.1 only: slow orbit so the lighting and shadows can be judged. Real camera comes in 5.3.
  const angle = now * 0.00008;
  camera.position.set(Math.cos(angle) * 38, 14, Math.sin(angle) * 38);
  camera.lookAt(0, 1, 0);
  lighting.follow(camera);
  renderer.render(scene, camera);
  if (now - lastOverlay > 500) {
    lastOverlay = now;
    const { calls, triangles } = renderer.info.render;
    overlay.textContent = `${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(0)} ms · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris`;
  }
});
