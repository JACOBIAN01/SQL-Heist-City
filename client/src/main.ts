import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  SIM_DT,
  TEST_MAP,
} from '@heist/shared';
import { CharacterModel, PALETTES } from './entities/CharacterModel';
import { RemotePlayers } from './entities/RemotePlayers';
import { loadCharacterAssets, gltfCharacterFactory } from './entities/characterAssets';
import type { CharacterFactory } from './entities/CharacterRig';
import { SnapshotClock } from './net/SnapshotClock';
import { thresholdsFor } from './entities/animation';
import { FixedStepLoop } from './game/FixedStepLoop';
import { LocalPlayer } from './game/LocalPlayer';
import { PredictedPlayer } from './game/PredictedPlayer';
import { GameClient } from './net/GameClient';
import { DelayedTransport, WebSocketGameTransport, type GameTransport } from './net/GameTransport';
import { InputBatcher } from './net/InputBatcher';
import { InputSampler } from './input/InputSampler';
import { PointerLock } from './input/PointerLock';
import { CombatFeedback } from './game/CombatFeedback';
import { HitboxDebug } from './entities/HitboxDebug';
import { Tracers } from './render/Tracers';
import { Hud } from './ui/hud/Hud';
import { CameraRig } from './render/CameraRig';
import { FrameStats } from './render/FrameStats';
import { addLighting } from './render/lighting';
import { computeViewport } from './render/viewport';
import { buildMapObject } from './world/MapRenderer';

// Composition root for the client.
/** Remote players are drawn this far in the past (smooth interpolation); shots are rewound by it too. */
const INTERP_DELAY_MS = 100;
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
const predicted = new PredictedPlayer(player);
const input = new InputSampler();
input.setLook(spawn.yaw);
const hint = document.createElement('div');
hint.textContent =
  'Click to play — WASD move · Shift sprint · Ctrl crouch · Space jump · Esc release mouse';
hint.style.cssText =
  'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);font:14px system-ui;color:#fff;background:#000a;padding:8px 14px;border-radius:6px;pointer-events:none';
document.body.appendChild(hint);
new PointerLock(renderer.domElement, input, (locked) => {
  hint.hidden = locked;
});
const rig = new CameraRig(camera, TEST_MAP);

// Network: ?server=<port> (default 8080), ?name=, ?lag=<one-way ms> to simulate latency.
const params = new URLSearchParams(location.search);
const port = params.get('server') ?? '8080';
const lag = Number(params.get('lag') ?? 0);
let transport: GameTransport = new WebSocketGameTransport(
  `ws://${location.hostname}:${port}/ws/game`,
);
if (lag > 0) transport = new DelayedTransport(transport, lag);
const client = new GameClient(transport, { name: params.get('name') ?? 'Player' });
const thresholds = thresholdsFor(
  DEFAULT_MOVEMENT_SETTINGS.walkSpeed,
  DEFAULT_MOVEMENT_SETTINGS.sprintSpeed,
);
// Real humans if the character files load; the placeholder boxes otherwise (offline, blocked asset, old browser).
const assets = await loadCharacterAssets().catch((error: unknown) => {
  console.warn('character models unavailable, using placeholders', error);
  return undefined;
});
const createRig: CharacterFactory = assets
  ? gltfCharacterFactory(assets, thresholds)
  : (seed) =>
      new CharacterModel(
        PALETTES[Math.abs(seed) % PALETTES.length] ?? {
          shirt: 0xd4a017,
          trousers: 0x222222,
          skin: 0xe0b48a,
        },
        thresholds,
      );
const remotes = new RemotePlayers(scene, createRig);
const serverClock = new SnapshotClock();
const hud = new Hud(document.body);
const tracers = new Tracers(scene);
// ?debug draws the server's hit-boxes around other players.
const hitboxes = params.has('debug')
  ? new HitboxDebug(scene, DEFAULT_COMBAT_SETTINGS, DEFAULT_MOVEMENT_SETTINGS)
  : undefined;
const playerName = params.get('name') ?? 'Player';
const feedback = new CombatFeedback({
  hud,
  tracers,
  map: TEST_MAP,
  movement: DEFAULT_MOVEMENT_SETTINGS,
  combat: DEFAULT_COMBAT_SETTINGS,
  myId: () => client.playerId,
  myName: () => playerName,
  nameOf: (id) => remotes.nameOf(id),
  positionOf: (id) => remotes.positionOf(id),
});
client.subscribe({
  snapshot: (snapshot) => {
    predicted.reconcile(snapshot.self, snapshot.ackSeq);
    feedback.onSnapshot(snapshot.self, performance.now() / 1000);
    serverClock.observe(snapshot.tick, client.tickRate, performance.now());
    remotes.onSnapshot(
      (snapshot.tick * 1000) / client.tickRate,
      snapshot.entities,
      snapshot.removed,
    );
  },
  event: (event) => {
    remotes.onEvent(event);
    feedback.onEvent(event);
  },
});
const batcher = new InputBatcher((commands) => client.sendInput(commands));

// Move now (prediction); the server confirms or corrects later. Offline play still works.
const loop = new FixedStepLoop(SIM_DT, () => {
  const command = input.sample();
  // Dead players do not move (the server ignores their input too); keep sending so it can acknowledge it.
  if (feedback.isAlive) {
    predicted.predict(command);
    feedback.onLocalCommand(command, player.body);
  }
  batcher.push(command);
});

const model = createRig(0);
scene.add(model.object);

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
  input.setViewLag(client.rttMs / 2 + INTERP_DELAY_MS);
  loop.advance(frameMs / 1000);
  batcher.flush(now);
  predicted.smooth(frameMs / 1000);
  tracers.update(frameMs / 1000);
  hitboxes?.update(remotes.poses());
  if (serverClock.ready)
    remotes.update(serverClock.serverTimeAt(now), frameMs / 1000, INTERP_DELAY_MS);

  predicted.drawPosition(loop.alpha, drawPos);
  model.object.visible = feedback.isAlive;
  model.object.position.set(drawPos.x, drawPos.y, drawPos.z);
  model.object.rotation.y = input.currentYaw;
  model.update(
    {
      speed: Math.hypot(player.body.vx, player.body.vz),
      crouching: player.body.crouching,
      onGround: player.body.onGround,
    },
    frameMs / 1000,
  );

  rig.update(
    drawPos.x,
    drawPos.y,
    drawPos.z,
    input.currentYaw,
    input.currentPitch,
    frameMs / 1000,
    player.body.crouching,
  );
  lighting.follow(model.object);
  renderer.render(scene, camera);

  if (now - lastOverlay > 500) {
    lastOverlay = now;
    const { calls, triangles } = renderer.info.render;
    overlay.textContent = `${client.status} · rtt ${client.rttMs.toFixed(0)} ms · players ${remotes.count + 1} · pending ${predicted.pendingCount} · corr ${predicted.lastCorrection.toFixed(3)} m · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(0)} ms · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris`;
  }
});
