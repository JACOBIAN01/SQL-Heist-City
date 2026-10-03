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
import { PointerLock } from './input/PointerLock';
import { CameraRig } from './render/CameraRig';
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
input.setLook(spawn.yaw);
const hint = document.createElement('div');
hint.textContent =
  'Click to play — WASD move · Shift sprint · Ctrl crouch · Space jump · Esc release mouse';
hint.style.cssText =
  'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);font:14px system-ui;color:#fff;background:#000a;padding:8px 14px;border-radius:6px;pointer-events:none';
document.body.appendChild(hint);
new PointerLock(renderer.domElement, input, (locked) => {
  hint.hidden = locked;
});
const rig = new CameraRig(camera, TEST_MAP);
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

  rig.update(
    drawPos.x,
    drawPos.y,
    drawPos.z,
    input.currentYaw,
    input.currentPitch,
    frameMs / 1000,
    player.body.crouching,
  );
  lighting.follow(body);
  renderer.render(scene, camera);

  if (now - lastOverlay > 500) {
    lastOverlay = now;
    const { calls, triangles } = renderer.info.render;
    overlay.textContent = `${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(0)} ms · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris`;
  }
});
