import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  SIM_DT,
  TEST_MAP,
  mapById,
  nearestAnchor,
  WEAPON_IDS,
  type SelfState,
  weaponFromWire,
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
import { buildTaskOptions } from './heist/taskOptions';
import { Hotkeys } from './input/Hotkeys';
import { InputSampler } from './input/InputSampler';
import { PointerLock } from './input/PointerLock';
import { CombatFeedback } from './game/CombatFeedback';
import { RoundUi } from './heist/RoundUi';
import { ScoreboardView } from './ui/hud/ScoreboardView';
import { BankingProgress } from './heist/BankingProgress';
import { LootRenderer } from './heist/LootRenderer';
import { HeistWorld } from './heist/HeistWorld';
import { gunTuning } from './entities/GltfCharacter';
import { createGun } from './entities/GunModel';
import { createCashBag } from './entities/CashBag';
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
// ?grot / ?gpos tune the in-hand gun pose while developing.
const triple = (v: string | null) =>
  v ? (v.split(',').map(Number) as [number, number, number]) : undefined;
const grot = triple(params.get('grot'));
if (grot) gunTuning.rotation = grot;
const brot = triple(params.get('brot'));
if (brot) gunTuning.backRotation = brot;
const bpos = triple(params.get('bpos'));
if (bpos) gunTuning.backPosition = bpos;
const gpos = triple(params.get('gpos'));
if (gpos) gunTuning.position = gpos;
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
const loot = new LootRenderer(scene);

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
  'Click to play — WASD move · Shift sprint · Ctrl crouch · Space jump · K or click fire · F use · Tab tasks · hold B scoreboard · 1–5 guns · Esc release mouse';
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
const bankingProgress = new BankingProgress(hud);
const scoreboard = new ScoreboardView(document.body, () => client.playerId);
const roundUi = new RoundUi(scoreboard);
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
  onLocalShot: () => model.fired(),
  myId: () => client.playerId,
  myName: () => playerName,
  nameOf: (id) => remotes.nameOf(id),
  positionOf: (id) => remotes.positionOf(id),
});
// Connect only once everything that reacts to the server exists: the first messages (welcome, vault and
// loot state) arrive right after joining and would be dropped if nobody were listening yet.
let transport: GameTransport = new WebSocketGameTransport(gameUrl);
if (lag > 0) transport = new DelayedTransport(transport, lag);
const client = new GameClient(transport, { name: params.get('name') ?? 'Player' });
client.subscribe({
  snapshot: (snapshot) => {
    latestSelf = snapshot.self;
    if (snapshot.self.weapon !== heldWeapon) {
      heldWeapon = snapshot.self.weapon;
      const id = WEAPON_IDS[heldWeapon - 1];
      model.holdItem(id ? createGun(id) : undefined);
      if (params.get('pose') === 'back') model.holdItem(createGun(params.get('gun') ?? 'rifle'));
      if (params.get('pose') === 'aim') {
        // Preview: draw, aim and let the pose settle at once (headless screenshots render too few frames to wait for it).
        model.fired();
        for (let i = 0; i < 40; i++)
          model.update({ speed: 0, crouching: false, onGround: true }, 0.03);
      }
    }
    predicted.reconcile(snapshot.self, snapshot.ackSeq);
    feedback.onSnapshot(snapshot.self, performance.now() / 1000, snapshot.ackSeq);
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
  closed: (reason) => {
    // The server said why (round under way, match full, out of date): show it and stay on screen.
    hint.hidden = false;
    hint.textContent = `Disconnected: ${reason}. Reload the page to try again.`;
  },
  json: (message) => {
    if (challengeApi.handle(message) || interactions.handle(message)) return;
    if (message.t === 'vaults') world.applyVaults(message.vaults);
    else if (message.t === 'round') roundUi.onRound(message, performance.now());
    else if (message.t === 'scores') roundUi.onScores(message);
    else if (message.t === 'standing') roundUi.onStanding(message);
    else if (message.t === 'arms') {
      ownedWeapons = message.owned;
      hud.setArms(message.owned, message.current);
    } else if (message.t === 'banking') bankingProgress.handle(message, performance.now());
    else if (message.t === 'loot') loot.apply(message.add, message.remove);
    else if (message.t === 'purse') {
      hud.setPurse(message.carried, message.banked);
      player.speedScale = message.speed;
      ownBag.visible = message.carried > 0;
    } else if (message.t === 'notice') hud.toast(message.text);
  },
});
// The SQL pop-up lives on the game connection: the server decides what each task is worth.
const challengeApi = new ChannelChallengeApi({ send: (message) => client.sendJson(message) });
const sqlPanel = new SqlPanel(document.body);
let ownedWeapons: readonly string[] = [];
let heldWeapon = 0;
// What the player can ask for depends on their situation; this is rebuilt each time the menu opens.
let latestSelf: SelfState | undefined;
const taskContext = () => {
  const self = latestSelf;
  const weapon = self ? weaponFromWire(self.weapon) : undefined;
  const anchor = nearestAnchor(MAP, player.body.x, player.body.y, player.body.z);
  const spec =
    anchor?.kind === 'vault_console'
      ? MAP.vaults?.find((v) => v.consoleId === anchor.id)
      : undefined;
  const view = spec ? world.vaults.find((v) => v.id === spec.id) : undefined;
  return {
    alive: feedback.isAlive,
    hp: self?.hp ?? DEFAULT_COMBAT_SETTINGS.maxHp,
    maxHp: DEFAULT_COMBAT_SETTINGS.maxHp,
    owned: ownedWeapons,
    weapon,
    ammo: self?.ammo ?? 0,
    magSize: weapon ? (DEFAULT_COMBAT_SETTINGS.weapons[weapon]?.magSize ?? 0) : 0,
    ...(view ? { vault: view } : {}),
  };
};
const sqlTasks = new SqlPanelController({
  panel: sqlPanel,
  api: challengeApi,
  tasks: () => buildTaskOptions(taskContext()),
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
// F uses what is in reach; the number keys hold a gun you own (the server confirms in the next snapshot).
new Hotkeys()
  .bind(['Tab'], () => {
    pointer.release();
    sqlTasks.pick();
  })
  .hold('KeyB', (down) => scoreboard.setBoardVisible(down))
  .bind(['KeyF'], () => {
    if (feedback.isAlive) void interactions.use();
  })
  .bind(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'], (code) => {
    const weapon = WEAPON_IDS[Number(code.slice(-1)) - 1];
    if (weapon && ownedWeapons.includes(weapon)) client.sendJson({ t: 'equip', weapon });
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
// Your own bag, on your back, while you carry cash (others see the same from the server's flag).
const ownBag = createCashBag();
ownBag.position.set(0, 0.95, 0.26);
ownBag.scale.setScalar(0.75);
ownBag.visible = params.has('bag'); // ?bag previews the bag without carrying cash
model.object.add(ownBag);

// ?pose=aim keeps the drawn-gun pose on screen for checking the animation without shooting.
if (params.get('pose') === 'aim') {
  // Preview without a server: equip a rifle and settle into the drawn pose straight away.
  model.holdItem(createGun(params.get('gun') ?? 'rifle'));
  model.fired();
  for (let i = 0; i < 40; i++) model.update({ speed: 0, crouching: false, onGround: true }, 0.03);
  setInterval(() => model.fired(), 400);
}

/** ?turn=<radians> turns the model away from the camera, to inspect poses from the side or front. */
const debugTurn = Number(params.get('turn') ?? 0);

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
  loot.update(now / 1000);
  bankingProgress.update(now);
  roundUi.update(now);
  hitboxes?.update(remotes.poses());
  if (serverClock.ready)
    remotes.update(serverClock.serverTimeAt(now), frameMs / 1000, INTERP_DELAY_MS);

  predicted.drawPosition(loop.alpha, drawPos);
  interactions.update(player.body.x, player.body.y, player.body.z, feedback.isAlive);
  model.object.visible = feedback.isAlive;
  model.object.position.set(drawPos.x, drawPos.y, drawPos.z);
  model.object.rotation.y = input.currentYaw + debugTurn;
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
