import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  SIM_DT,
  TEST_MAP,
  mapById,
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
import { chooseGameUrl } from './net/lobby';
import { InputSampler } from './input/InputSampler';
import { PointerLock } from './input/PointerLock';
import { CombatFeedback } from './game/CombatFeedback';
import { HeistWorld } from './heist/HeistWorld';
import { Interactions } from './heist/Interactions';
import { HitboxDebug } from './entities/HitboxDebug';
import { Tracers } from './render/Tracers';
import { Hud } from './ui/hud/Hud';
import { CameraRig } from './render/CameraRig';
import { FrameStats } from './render/FrameStats';
import { addLighting } from './render/lighting';
import { computeViewport } from './render/viewport';
import { ChannelChallengeApi } from './net/ChannelChallengeApi';
import { SqlPanel } from './ui/sql/SqlPanel';
import { StorageDraftStore } from './ui/sql/DraftStore';
import { SqlPanelController } from './ui/sql/SqlPanelController';
import { rewardLabel } from './ui/sql/labels';
import './ui/sql/sqlPanel.css';
import { buildMapObject, setClosedDoors } from './world/MapRenderer';

// Composition root for the client.
// ?map=heist loads the bank map (the server must run MATCH_MAP=heist); the sandbox yard is the default.
const params = new URLSearchParams(location.search);
const MAP = mapById(params.get('map')) ?? TEST_MAP;
/** Remote players are drawn this far in the past (smooth interpolation); shots are rewound by it too. */
const INTERP_DELAY_MS = 100;
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const lighting = addLighting(scene);
const mapObject = buildMapObject(MAP);
scene.add(mapObject);
const world = new HeistWorld(MAP);

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

const spawn = MAP.spawns[0] ?? { x: 0, z: 0, yaw: 0 };
const player = new LocalPlayer(MAP, DEFAULT_MOVEMENT_SETTINGS, spawn);
const predicted = new PredictedPlayer(player);
const input = new InputSampler();
input.setLook(spawn.yaw);
const hint = document.createElement('div');
hint.textContent =
  'Click to play — WASD move · Shift sprint · Ctrl crouch · Space jump · Esc release mouse';
hint.style.cssText =
  'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);font:14px system-ui;color:#fff;background:#000a;padding:8px 14px;border-radius:6px;pointer-events:none';
document.body.appendChild(hint);
const pointer = new PointerLock(renderer.domElement, input, (locked) => {
  hint.hidden = locked;
});
const rig = new CameraRig(camera, MAP);

// Network: ?server=<port> (default 8080), ?name=, ?lag=<one-way ms> to simulate latency.
const port = params.get('server') ?? '8080';
const lag = Number(params.get('lag') ?? 0);
// The lobby says which match (and which port, when matches run in their own threads) to join.
const gameUrl = await chooseGameUrl(location.hostname, port);
let transport: GameTransport = new WebSocketGameTransport(gameUrl);
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
  map: MAP,
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
  json: (message) => {
    if (challengeApi.handle(message) || interactions.handle(message)) return;
    if (message.t === 'vaults') world.applyVaults(message.vaults);
    else if (message.t === 'notice') hud.toast(message.text);
  },
});
// The SQL pop-up lives on the game connection: the server decides what each task is worth.
const challengeApi = new ChannelChallengeApi({ send: (message) => client.sendJson(message) });
const sqlPanel = new SqlPanel(document.body);
const sqlTasks = new SqlPanelController({
  panel: sqlPanel,
  api: challengeApi,
  drafts: new StorageDraftStore(sessionStorage),
  onHintCharged: (hint) => hud.toast(`Hint revealed (cost ${hint.cost})`),
});
// A vault door opening changes what everyone collides with.
world.onChange((map, closedDoors) => {
  player.setMap(map);
  rig.setMap(map);
  feedback.setMap(map);
  setClosedDoors(mapObject, closedDoors);
});
// F uses whatever is in reach (lift, vault console…); the server decides if it works.
const interactions = new Interactions({
  map: MAP,
  send: (message) => client.sendJson(message),
  view: hud,
  onOpenTask: (rewardKey, target) => {
    // The panel needs the mouse (the world keeps running behind it).
    pointer.release();
    void sqlTasks.start({
      key: rewardKey,
      label: rewardLabel(rewardKey),
      group: rewardKey.split(':')[0] ?? 'Task',
      target,
    });
  },
});
window.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof Element && event.target.closest('input, textarea, .cm-editor');
  if (event.code === 'KeyF' && !event.repeat && !typing && feedback.isAlive)
    void interactions.use();
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
  interactions.update(player.body.x, player.body.y, player.body.z, feedback.isAlive);
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
