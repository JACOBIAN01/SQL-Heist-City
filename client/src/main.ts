import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { DEFAULT_MOVEMENT_SETTINGS, SIM_DT, TEST_MAP } from '@heist/shared';
import { FixedStepLoop } from './game/FixedStepLoop';
import { LocalPlayer } from './game/LocalPlayer';
import { InputSampler } from './input/InputSampler';
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

const spawn = TEST_MAP.spawns[0] ?? { x: 0, z: 0, yaw: 0 };
const player = new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn);
const input = new InputSampler();
input.setLooking(true); // 5.3 ties this to pointer lock; until then mouse always turns the view.
input.setLook(spawn.yaw);
const loop = new FixedStepLoop(SIM_DT, () => player.apply(input.sample()));

// 5.2 placeholder body and chase camera; replaced by the model (5.4) and camera rig (5.3).
const body = new Mesh(
  new BoxGeometry(0.7, 1.8, 0.7),
  new MeshStandardMaterial({ color: 0xd4a017 }),
);
body.castShadow = true;
scene.add(body);

const stats = new FrameStats();
const overlay = document.createElement('div');
overlay.style.cssText =
  'position:fixed;left:8px;top:8px;font:12px ui-monospace,monospace;color:#fff;background:#0008;padding:4px 8px;border-radius:4px;pointer-events:none';
document.body.appendChild(overlay);

const drawPos = { x: 0, y: 0, z: 0 };
let last = performance.now();
let lastOverlay = 0;
renderer.setAnimationLoop((now) => {
  const frameMs = now - last;
  last = now;
  stats.push(frameMs);
  loop.advance(frameMs / 1000);

  player.drawPosition(loop.alpha, drawPos);
  const height = player.body.crouching
    ? DEFAULT_MOVEMENT_SETTINGS.crouchHeight
    : DEFAULT_MOVEMENT_SETTINGS.standHeight;
  body.scale.y = height / DEFAULT_MOVEMENT_SETTINGS.standHeight;
  body.position.set(drawPos.x, drawPos.y + height / 2, drawPos.z);
  body.rotation.y = input.currentYaw;

  const yaw = input.currentYaw;
  camera.position.set(drawPos.x + Math.sin(yaw) * 5, drawPos.y + 3, drawPos.z + Math.cos(yaw) * 5);
  camera.lookAt(drawPos.x, drawPos.y + 1.4, drawPos.z);
  lighting.follow(body);
  renderer.render(scene, camera);

  if (now - lastOverlay > 500) {
    lastOverlay = now;
    const { calls, triangles } = renderer.info.render;
    overlay.textContent = `${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(0)} ms · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris`;
  }
});
