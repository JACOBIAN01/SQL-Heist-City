import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  hourAt,
  SIM_DT,
  TEST_MAP,
  BANK_LAYOUTS,
  mapById,
  nearestAnchor,
  WEAPON_IDS,
  Flag,
  type SelfState,
  weaponFromWire,
} from '@heist/shared';
import { GameAudio, type HeardCar } from './audio/GameAudio';
import { GestureAudio } from './audio/GestureAudio';
import { prepareSounds } from './audio/synth';
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
import { createGun } from './entities/GunModel';
import { Interactions } from './heist/Interactions';
import { HitboxDebug } from './entities/HitboxDebug';
import { Tracers } from './render/Tracers';
import { Hud } from './ui/hud/Hud';
import { CameraRig } from './render/CameraRig';
import { FrameStats } from './render/FrameStats';
import { loadCarAssets, type CarAssets } from './vehicles/carAssets';
import { followAngle, PredictedVehicle } from './vehicles/PredictedVehicle';
import { RemoteVehicles } from './vehicles/RemoteVehicles';
import { VehicleControls } from './vehicles/VehicleControls';
import { FrameBudget, PostFx } from './render/PostFx';
import { QualityLadder } from './render/quality';
import { addLighting } from './render/lighting';
import { computeViewport } from './render/viewport';
import { sceneBudget } from './render/sceneBudget';
import { ChannelChallengeApi } from './net/ChannelChallengeApi';
import { SqlPanel } from './ui/sql/SqlPanel';
import { StorageDraftStore } from './ui/sql/DraftStore';
import { SqlPanelController } from './ui/sql/SqlPanelController';
import { rewardLabel } from './ui/sql/labels';
import './ui/sql/sqlPanel.css';
import { buildMapObject, hideKitCovered, setClosedDoors } from './world/MapRenderer';
import { loadCityKit, type CityKit } from './world/city/CityKit';
import { setNightGlow } from './world/city/kitMaterials';
import { skyAt } from './render/dayNight';
import { createCityArt, type CityStreamer } from './world/city/CityRenderer';
import { followServerMap } from './world/followServerMap';

// Composition root for the client.
// ?map=heist|city|city:<seed> picks the map; on joining, the page follows whatever map the server plays.
const params = new URLSearchParams(location.search);
// Without ?map the page builds the default city (the server's default too, so no reload).
const MAP = mapById(params.get('map') ?? 'city') ?? TEST_MAP;
/** Remote players are drawn this far in the past (smooth interpolation); shots are rewound by it too. */
const INTERP_DELAY_MS = 100;
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const lighting = addLighting(scene);
/** Re-light the scene when the hour has moved this much (~10 s of a 30-minute day). */
const SKY_STEP_HOURS = 0.005;
/** How quickly the chase camera turns after the car (1/s), and how far it looks down (rad). */
const CHASE_RATE = 5;
const CHASE_PITCH = -0.18;
const hourParam = params.get('hour');
const fixedHour = hourParam !== null && hourParam !== '' ? Number(hourParam) : undefined;
const mapObject = buildMapObject(MAP);
scene.add(mapObject);
const world = new HeistWorld(MAP);
const loot = new LootRenderer(scene);

const camera = new PerspectiveCamera(70, 1, 0.1, 220);
// Bloom + FXAA. ?fx=high|fxaa|off pins a level; otherwise it starts high and, while frames stay
// over budget, steps down the quality ladder (effects first, then resolution), so slow laptops
// keep their frame rate.
const fxParam = params.get('fx');
const postFx = new PostFx(renderer, scene, camera);
if (fxParam === 'high' || fxParam === 'fxaa' || fxParam === 'off') postFx.setLevel(fxParam);
const quality = fxParam ? undefined : new QualityLadder(window.devicePixelRatio);
const fxBudget = quality ? new FrameBudget() : undefined;
// The composer renders several passes a frame; count them all in the overlay.
renderer.info.autoReset = false;
const resize = (): void => {
  const v = computeViewport(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio,
    quality?.current.maxPixelRatio,
  );
  renderer.setPixelRatio(v.pixelRatio);
  renderer.setSize(v.width, v.height);
  postFx.setSize(v.width, v.height, v.pixelRatio);
  camera.aspect = v.aspect;
  camera.updateProjectionMatrix();
};
resize();
window.addEventListener('resize', resize);

const spawn = MAP.spawns[0] ?? { x: 0, z: 0, yaw: 0 };
const player = new LocalPlayer(MAP, DEFAULT_MOVEMENT_SETTINGS, spawn);
// A generated city is drawn with kit pieces once they arrive (near blocks in detail, the rest as
// impostors); until then, or if they fail to load, as boxes.
let cityArt: CityStreamer | undefined;
let cityKit: CityKit | undefined;
const city = MAP.city;
if (city)
  loadCityKit()
    .then((kit) => {
      cityKit = kit;
      cityArt = createCityArt(kit, city, BANK_LAYOUTS);
      cityArt.prime(player.body.x, player.body.z);
      scene.add(cityArt.root);
      hideKitCovered(mapObject);
      setNightGlow(kit.materials, lighting.state.night);
    })
    .catch((error: unknown) => console.warn('city kit unavailable, drawing boxes', error));
const predicted = new PredictedPlayer(player);
const input = new InputSampler();
input.setLook(spawn.yaw);
// ?at=x,z[,y[,yaw]] starts the player there, to look at a place (offline: a server puts you back).
const atParam = params.get('at')?.split(',').map(Number);
if (atParam && atParam.length >= 2 && atParam.every(Number.isFinite)) {
  const [x = 0, z = 0, y = 0, yaw] = atParam;
  player.teleport(x, y, z);
  if (yaw !== undefined) input.setLook(yaw);
}
const hint = document.createElement('div');
hint.textContent =
  'Click to play — WASD move · Shift sprint · Ctrl crouch · Space jump · K or click fire · F use · Tab tasks · hold B scoreboard · 1–5 guns · M mute · Esc release mouse';
hint.style.cssText =
  'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);font:14px system-ui;color:#fff;background:#000a;padding:8px 14px;border-radius:6px;pointer-events:none';
document.body.appendChild(hint);
const pointer = new PointerLock(renderer.domElement, input, (locked) => {
  hint.hidden = locked;
});
const rig = new CameraRig(camera, MAP);
// Behind and above a car, centred (no shoulder), pulled in by walls like the on-foot camera.
const carRig = new CameraRig(camera, MAP, { distance: 7.5, shoulder: 0, pivotHeight: 1.7 });
/** Chase-camera heading: follows the car's with a short lag (rad). */
let chaseYaw: number | undefined;

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
// Cars: the server owns them; this draws them, and predicts the one you drive.
const vehicles = new RemoteVehicles(scene, DEFAULT_VEHICLE_SETTINGS);
player.cars = vehicles.footprints();
let myCar: PredictedVehicle | undefined;
let carAssets: CarAssets | undefined;
/** What movement collides with right now (vault doors change it); the driven car uses it too. */
let collisionMap = MAP;
const driverIds = new Set<number>();
if (MAP.parkedCars?.length)
  loadCarAssets()
    .then((cars) => {
      carAssets = cars;
      cars.nightGlow.value = lighting.state.night;
      vehicles.setAssets(cars);
    })
    .catch((error: unknown) => console.warn('car models unavailable', error));
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
// Sound: silent until the first click or key press (browsers insist), then made in code. ?mute starts muted.
const sound = new GestureAudio(DEFAULT_AUDIO_SETTINGS, undefined, undefined, params.has('mute'));
prepareSounds((work) =>
  'requestIdleCallback' in window ? requestIdleCallback(work) : setTimeout(work, 50),
);
for (const gesture of ['pointerdown', 'keydown'] as const)
  window.addEventListener(gesture, () => sound.start());
const audio = new GameAudio({
  out: sound,
  settings: DEFAULT_AUDIO_SETTINGS,
  vehicles: DEFAULT_VEHICLE_SETTINGS,
  map: MAP,
  myId: () => client.playerId,
  positionOf: (id) => remotes.positionOf(id),
  weaponOf: (id) => remotes.weaponOf(id),
});
const feedback = new CombatFeedback({
  hud,
  tracers,
  map: MAP,
  movement: DEFAULT_MOVEMENT_SETTINGS,
  combat: DEFAULT_COMBAT_SETTINGS,
  onLocalShot: (weapon) => {
    model.fired();
    audio.localShot(weapon);
  },
  onDryFire: () => audio.dryFire(),
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
  welcome: (message) => {
    const next = followServerMap(MAP.id, message.mapId, location.search);
    if (next) location.search = next;
  },
  snapshot: (snapshot) => {
    latestSelf = snapshot.self;
    if (snapshot.self.weapon !== heldWeapon) {
      heldWeapon = snapshot.self.weapon;
      const id = WEAPON_IDS[heldWeapon - 1];
      model.holdItem(id ? createGun(id) : undefined);
    }
    const serverMs = (snapshot.tick * 1000) / client.tickRate;
    vehicles.onSnapshot(serverMs, snapshot.vehicles, snapshot.vehiclesRemoved);
    syncOwnCar(snapshot.self.vehicle, snapshot.ackSeq);
    // At the wheel the body just rides along; on foot it is predicted and reconciled.
    if (myCar) predicted.follow(snapshot.self);
    else predicted.reconcile(snapshot.self, snapshot.ackSeq);
    feedback.onSnapshot(snapshot.self, performance.now() / 1000, snapshot.ackSeq);
    audio.onHealth(snapshot.self.hp, (snapshot.self.flags & Flag.Alive) !== 0);
    serverClock.observe(snapshot.tick, client.tickRate, performance.now());
    remotes.onSnapshot(serverMs, snapshot.entities, snapshot.removed);
  },
  event: (event) => {
    remotes.onEvent(event);
    feedback.onEvent(event);
    audio.onEvent(event);
  },
  closed: (reason) => {
    // The server said why (round under way, match full, out of date): show it and stay on screen.
    hint.hidden = false;
    hint.textContent = `Disconnected: ${reason}. Reload the page to try again.`;
  },
  json: (message) => {
    if (challengeApi.handle(message) || interactions.handle(message)) return;
    if (vehicleControls.handle(message)) return;
    if (message.t === 'vaults') {
      world.applyVaults(message.vaults);
      audio.onVaults(message.vaults);
    } else if (message.t === 'round') roundUi.onRound(message, performance.now());
    else if (message.t === 'scores') roundUi.onScores(message);
    else if (message.t === 'standing') roundUi.onStanding(message);
    else if (message.t === 'arms') {
      ownedWeapons = message.owned;
      hud.setArms(message.owned, message.current);
    } else if (message.t === 'banking') bankingProgress.handle(message, performance.now());
    else if (message.t === 'loot') loot.apply(message.add, message.remove);
    else if (message.t === 'purse') {
      hud.setPurse(message.carried, message.banked);
      audio.onPurse(message.carried, message.banked);
      player.speedScale = message.speed;
      model.setCarrying(message.carried > 0 || params.has('bag'));
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
  collisionMap = map;
  myCar?.setMap(map);
  player.setMap(map);
  rig.setMap(map);
  carRig.setMap(map);
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
  .bind(['KeyM'], () => hud.toast(sound.toggleMute() ? 'Sound off (M)' : 'Sound on (M)'))
  .bind(['KeyF'], () => {
    if (!feedback.isAlive) return;
    // A lift, vault or safehouse in reach comes first; otherwise F is for cars.
    if (vehicleControls.available && !interactions.hasTarget) void vehicleControls.use();
    else void interactions.use();
  })
  .bind(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'], (code) => {
    const weapon = WEAPON_IDS[Number(code.slice(-1)) - 1];
    if (weapon && ownedWeapons.includes(weapon)) client.sendJson({ t: 'equip', weapon });
  });
const batcher = new InputBatcher((commands) => client.sendInput(commands));

/** Starts, keeps or stops predicting the car the server says you drive. */
function syncOwnCar(id: number, ackSeq: number): void {
  vehicles.ownId = id;
  if (!id) {
    myCar = undefined;
    chaseYaw = undefined;
    return;
  }
  const server = vehicles.latest(id);
  const model = vehicles.modelOf(id);
  if (!server || !model) return;
  if (myCar?.id === id) myCar.reconcile(server, ackSeq);
  else {
    myCar = new PredictedVehicle(
      id,
      model,
      collisionMap,
      DEFAULT_VEHICLE_SETTINGS.kinds[server.kind],
      server,
    );
    chaseYaw = server.yaw;
  }
}

const vehicleControls = new VehicleControls({
  send: (message) => client.sendJson(message),
  view: hud,
  vehicles,
});

// Move now (prediction); the server confirms or corrects later. Offline play still works.
const loop = new FixedStepLoop(SIM_DT, () => {
  const command = input.sample();
  if (myCar && feedback.isAlive) {
    // At the wheel the stick drives the car, here at once and on the server from the same command.
    myCar.predict(command);
    batcher.push(command);
    return;
  }
  // Dead players do not move (the server ignores their input too); keep sending so it can acknowledge it.
  if (feedback.isAlive) {
    predicted.predict(command);
    feedback.onLocalCommand(command, player.body);
  }
  batcher.push(command);
});

const model = createRig(0);
scene.add(model.object);
// ?bag previews the carried bag without carrying cash.
if (params.has('bag')) model.setCarrying(true);
// ?lowpoly: show your own player with the light body others see beyond 25 m, to judge the LOD.
if (params.has('lowpoly')) model.setFar(true);

// ?pose=back|aim previews the slung or drawn gun without a server (for checking how they look).
const previewPose = params.get('pose');
if (previewPose === 'back' || previewPose === 'aim')
  model.holdItem(createGun(params.get('gun') ?? 'rifle'));
if (previewPose === 'aim') {
  model.fired();
  for (let i = 0; i < 40; i++) model.update({ speed: 0, crouching: false, onGround: true }, 0.03);
  setInterval(() => model.fired(), 400);
}

/** ?turn=<radians> turns the model away from the camera, to inspect poses from the side or front. */
const debugTurn = Number(params.get('turn') ?? 0);

// ?perf: `__budget()` in the console lists the triangles in view per part of the scene.
if (params.has('perf'))
  Object.assign(window, { __budget: () => sceneBudget(scene, camera), __renderer: renderer });

const stats = new FrameStats();
const overlay = document.createElement('div');
overlay.style.cssText =
  'position:fixed;left:8px;top:8px;font:12px ui-monospace,monospace;color:#fff;background:#0008;padding:4px 8px;border-radius:4px;pointer-events:none';
document.body.appendChild(overlay);

const drawPos = { x: 0, y: 0, z: 0 };
const earForward = new Vector3();
const earUp = new Vector3();
/** Cars as audio hears them: the one you drive where your prediction has it, the rest as last sent. */
function* heardCars(): Iterable<HeardCar> {
  for (const car of vehicles.states()) {
    if (myCar && car.id === myCar.id) {
      const { x, z, speed } = myCar.state;
      yield { ...car, x, z, speed };
    } else yield car;
  }
}
let last = performance.now();
let lastOverlay = 0;
renderer.setAnimationLoop((now) => {
  const frameMs = now - last;
  last = now;
  stats.push(frameMs);
  renderer.info.reset();
  if (quality && fxBudget?.push(frameMs) && quality.stepDown()) {
    postFx.setLevel(quality.current.fx);
    resize();
    console.info(
      `frames over budget: quality down to ${quality.current.fx} at ${quality.pixelRatio}× pixels`,
    );
  }
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
    remotes.update(
      serverClock.serverTimeAt(now),
      frameMs / 1000,
      INTERP_DELAY_MS,
      camera.position,
      vehicles.drivers(driverIds),
    );
  if (serverClock.ready)
    vehicles.update(serverClock.serverTimeAt(now), INTERP_DELAY_MS, camera.position);

  predicted.drawPosition(loop.alpha, drawPos);
  cityArt?.update(camera.position.x, camera.position.z);
  interactions.update(player.body.x, player.body.y, player.body.z, feedback.isAlive && !myCar);
  vehicleControls.update(
    player.body.x,
    player.body.z,
    !!myCar,
    feedback.isAlive,
    interactions.hasTarget,
  );
  model.object.visible = feedback.isAlive && !myCar;
  const driven = myCar?.draw(loop.alpha, frameMs / 1000);
  model.object.position.set(drawPos.x, drawPos.y, drawPos.z);
  model.object.rotation.y = input.currentYaw + debugTurn;
  model.setAimPitch(input.currentPitch);
  model.update(
    {
      speed: Math.hypot(player.body.vx, player.body.vz),
      crouching: player.body.crouching,
      onGround: player.body.onGround,
    },
    frameMs / 1000,
  );

  // Driving: a chase camera behind the car, swinging round after it as it turns.
  if (driven) {
    chaseYaw = followAngle(chaseYaw ?? driven.yaw, driven.yaw, frameMs / 1000, CHASE_RATE);
    carRig.update(
      driven.x,
      0,
      driven.z,
      chaseYaw,
      CHASE_PITCH + Math.min(0, input.currentPitch),
      frameMs / 1000,
    );
  } else
    rig.update(
      drawPos.x,
      drawPos.y,
      drawPos.z,
      input.currentYaw,
      input.currentPitch,
      frameMs / 1000,
      player.body.crouching,
    );
  // Time of day from the match clock, so every player shares one sky (?hour=22 pins it).
  const hour =
    fixedHour ??
    hourAt(serverClock.ready ? serverClock.serverTimeAt(now) : 0, DEFAULT_ATMOSPHERE_SETTINGS);
  if (Math.abs(hour - lighting.state.hour) > SKY_STEP_HOURS) {
    lighting.apply(skyAt(hour));
    postFx.setNight(lighting.state.night);
    if (cityKit) setNightGlow(cityKit.materials, lighting.state.night);
    if (carAssets) carAssets.nightGlow.value = lighting.state.night;
  }
  camera.getWorldDirection(earForward);
  earUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  audio.update({
    dt: frameMs / 1000,
    listener: { at: camera.position, forward: earForward, up: earUp },
    me: {
      x: player.body.x,
      y: player.body.y,
      z: player.body.z,
      onGround: player.body.onGround,
      crouching: player.body.crouching,
      alive: feedback.isAlive,
      driving: !!myCar,
    },
    others: remotes.poses(),
    drivers: driverIds,
    cars: heardCars(),
  });
  lighting.frame(camera);
  lighting.follow(myCar ? myCar.model.object : model.object);
  postFx.render(scene, camera);

  if (now - lastOverlay > 500) {
    lastOverlay = now;
    const { calls, triangles } = renderer.info.render;
    overlay.textContent = `${client.status} · rtt ${client.rttMs.toFixed(0)} ms · players ${remotes.count + 1} · pending ${predicted.pendingCount} · corr ${predicted.lastCorrection.toFixed(3)} m · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(0)} ms · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris · fx ${postFx.level} @${renderer.getPixelRatio()}×`;
  }
});
