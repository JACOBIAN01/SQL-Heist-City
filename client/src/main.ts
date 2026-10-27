import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  hourAt,
  weatherAt,
  DEFAULT_ATMOSPHERE_SETTINGS,
  SIM_DT,
  TEST_MAP,
  BANK_LAYOUTS,
  mapById,
  nearestAnchor,
  WEAPON_IDS,
  Flag,
  type ProfileMessage,
  type SelfState,
  type WantedView,
  weaponFromWire,
  TUTORIAL_STEPS,
} from '@heist/shared';
import { GameAudio, type HeardCar } from './audio/GameAudio';
import { GestureAudio } from './audio/GestureAudio';
import { CaptionedAudio } from './audio/CaptionedAudio';
import { CaptionView } from './ui/hud/CaptionView';
import { RankView } from './ui/hud/RankView';
import { SkillTreeView } from './ui/profile/SkillTreeView';
import { WardrobeView } from './ui/profile/WardrobeView';
import { ContractsView } from './ui/profile/ContractsView';
import { LeagueView } from './ui/profile/LeagueView';
import { ShareCardView } from './ui/share/ShareCardView';
import { SquadView } from './ui/hud/SquadView';
import { CollectionView } from './ui/hud/CollectionView';
import { PoliceStars } from './ui/hud/PoliceStars';
import { ActsView } from './ui/hud/ActsView';
import { BoardView } from './ui/hud/BoardView';
import { ApproachBadge } from './ui/hud/ApproachBadge';
import { JobView } from './ui/hud/JobView';
import { ShopView } from './ui/hud/ShopView';
import { DuelView } from './ui/hud/DuelView';
import { CrowdModel } from './world/crowd/CrowdModel';
import { CrowdRenderer } from './world/crowd/CrowdRenderer';
import { foeMarkers, mateMarkers } from './ui/minimap/minimapModel';
import type { ProgressMessage, ReviewMessage, RoundMessage } from '@heist/shared';
import type { LookView } from '@heist/shared';
import { SettingsPanel } from './ui/settings/SettingsPanel';
import { startSettings } from './settings/bootstrap';
import { controlsHint } from './settings/controlsHint';
import { bindingsFrom } from './input/Bindings';
import { GamepadAdapter } from './input/GamepadAdapter';
import { TouchControls } from './ui/touch/TouchControls';
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
import { HttpAccountApi } from './net/account';
import { serverAddressFor } from './net/serverAddress';
import { classRoomUrl, roomStatus } from './net/classRoom';
import { h } from './ui/dom';
import { ReviewView } from './ui/profile/ReviewView';
import { ProfileView } from './ui/profile/ProfileView';
import { LiveWorld } from './net/liveWorld';
import { setRewardIcons } from './ui/icons/icons';
import { chooseGameUrl, tutorialUrl } from './net/lobby';
import { buildTaskOptions } from './heist/taskOptions';
import { Hotkeys } from './input/Hotkeys';
import { InputSampler } from './input/InputSampler';
import { PointerLock } from './input/PointerLock';
import { CombatFeedback } from './game/CombatFeedback';
import { RoundUi } from './heist/RoundUi';
import { ScoreboardView } from './ui/hud/ScoreboardView';
import { BankingProgress } from './heist/BankingProgress';
import { CacheBeacons } from './heist/CacheBeacons';
import { LootRenderer } from './heist/LootRenderer';
import { HeistWorld } from './heist/HeistWorld';
import { createGun } from './entities/GunModel';
import { Interactions } from './heist/Interactions';
import { HitboxDebug } from './entities/HitboxDebug';
import { Tracers } from './render/Tracers';
import { Hud } from './ui/hud/Hud';
import { CameraRig } from './render/CameraRig';
import { FrameStats } from './render/FrameStats';
import { AimView } from './render/AimView';
import { WeaponTable } from './game/WeaponTable';
import {
  hospitalMarker,
  type Marker,
  markersFor,
  objectiveMarker,
  VaultAlerts,
} from './ui/minimap/minimapModel';
import { FullMapView } from './ui/minimap/FullMapView';
import { TutorialBeacon } from './tutorial/TutorialBeacon';
import {
  realMatchSearch,
  TutorialGuide,
  tutorialInvite,
  tutorialTarget,
} from './tutorial/TutorialGuide';
import { feedText } from './heist/feedText';
import { MinimapView } from './ui/minimap/MinimapView';
import { loadCarAssets, type CarAssets } from './vehicles/carAssets';
import { followAngle, PredictedVehicle } from './vehicles/PredictedVehicle';
import { RemoteVehicles } from './vehicles/RemoteVehicles';
import { VehicleControls } from './vehicles/VehicleControls';
import { FrameBudget, PostFx } from './render/PostFx';
import { QUALITY_PRESETS, QualityLadder, type QualityRung } from './render/quality';
import { addLighting } from './render/lighting';
import { WeatherFx, pinnedWeather } from './render/WeatherFx';
import { computeViewport } from './render/viewport';
import { sceneBudget } from './render/sceneBudget';
import { ChannelChallengeApi } from './net/ChannelChallengeApi';
import { SqlPanel } from './ui/sql/SqlPanel';
import { StorageDraftStore } from './ui/sql/DraftStore';
import { SqlPanelController } from './ui/sql/SqlPanelController';
import { rewardLabel } from './ui/sql/labels';
import './ui/sql/sqlPanel.css';
import {
  buildMapObject,
  hideFurnitureBoxes,
  hideKitCovered,
  setClosedDoors,
} from './world/MapRenderer';
import { buildBankFurniture } from './world/bank/BankFurnitureArt';
import { buildBankFacades } from './world/bank/BankFacadeArt';
import { buildBankDecor } from './world/bank/BankDecorArt';
import { BankLod } from './world/bank/BankLod';
import { buildBankFixtures } from './world/bank/BankFixturesArt';
import { buildBankShells, insideDressedBank } from './world/bank/BankShellArt';
import { createBankMaterials } from './world/bank/bankMaterials';
import { VaultArt } from './world/bank/VaultArt';
import { loadInteriorKit, type InteriorKit } from './world/bank/InteriorKit';
import { loadCityKit, type CityKit } from './world/city/CityKit';
import { setNightGlow } from './world/city/kitMaterials';
import { skyAt } from './render/dayNight';
import { createCityArt, type CityStreamer } from './world/city/CityRenderer';
import { followServerMap } from './world/followServerMap';

// Composition root for the client.
// ?map=heist|city|city:<seed> picks the map; on joining, the page follows whatever map the server plays.
const params = new URLSearchParams(location.search);
const server = serverAddressFor(location, params);
// The player's own settings (keys, look, sound, picture, access, language), live from here on.
const account = new HttpAccountApi(server.account());
const { store: settings, i18n } = startSettings(account);
const bindings = bindingsFrom(() => settings.current);
// ?tutorial plays the tutorial: a private room on the tutorial map, with a guide.
const tutorial = params.has('tutorial');
const weatherPin = params.get('weather');
// Without ?map the page builds the default city (the server's default too, so no reload).
// ?class=<id> plays the city of that class's room, whatever the page was opened with.
const classId = Number(params.get('class') ?? 0) || undefined;
const classRoom = classId ? await roomStatus(server, classId) : undefined;
if (classId && classRoom?.state !== 'live') {
  // The room closed (or never opened): back to the menu.
  location.search = '';
  await new Promise(() => {});
}
const classMap = classRoom?.state === 'live' ? classRoom.mapId : undefined;
const MAP = mapById(tutorial ? 'tutorial' : (classMap ?? params.get('map') ?? 'city')) ?? TEST_MAP;
/** Remote players are drawn this far in the past (smooth interpolation); shots are rewound by it too. */
const INTERP_DELAY_MS = 100;
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const lighting = addLighting(scene);
const weatherFx = new WeatherFx(scene, lighting, DEFAULT_ATMOSPHERE_SETTINGS.weather);
/** Re-light the scene when the hour has moved this much (~10 s of a 30-minute day). */
const SKY_STEP_HOURS = 0.005;
/** How quickly the chase camera turns after the car (1/s), and how far it looks down (rad). */
const CHASE_RATE = 5;
const CHASE_PITCH = -0.18;
const hourParam = params.get('hour');
const fixedHour = hourParam !== null && hourParam !== '' ? Number(hourParam) : undefined;
// Banks are dressed (floors, walls, ceilings, stone) instead of drawn as plain boxes.
const bankMaterials = MAP.banks?.length ? createBankMaterials() : undefined;
const mapObject = buildMapObject(MAP, bankMaterials ? insideDressedBank(MAP) : undefined);
scene.add(mapObject);
// Interiors are drawn only near a bank, and only the storeys that can be seen (BankLod).
const bankLod = new BankLod(MAP.banks ?? [], BANK_LAYOUTS);
if (bankMaterials) {
  scene.add(buildBankShells(MAP, bankMaterials));
  const fixtures = buildBankFixtures(MAP, bankMaterials);
  scene.add(fixtures);
  bankLod.add(fixtures);
}
const decor = bankMaterials ? buildBankDecor(MAP) : undefined;
if (decor) {
  scene.add(decor.root);
  bankLod.add(decor.root);
}
const facades = bankMaterials ? buildBankFacades(MAP, bankMaterials) : undefined;
if (facades) scene.add(facades.root);
// Round vault doors that turn, unbolt and swing open as locks are cracked; keypads and alarms.
const vaultArt = bankMaterials ? new VaultArt(MAP, bankMaterials) : undefined;
if (vaultArt) {
  scene.add(vaultArt.root);
  bankLod.add(vaultArt.root);
}
// ?vaultdemo cracks every vault's three locks offline, 3 s apart, to watch the door (no server needed).
if (vaultArt && params.has('vaultdemo')) {
  const views = (opened: number) =>
    (MAP.vaults ?? []).map((v) => ({ id: v.id, tier: v.tier, locks: 3, opened }));
  for (const opened of [0, 1, 2, 3])
    setTimeout(
      () => {
        const now = performance.now() / 1000;
        vaultAlerts.observe(views(opened), now);
        vaultArt.onVaults(views(opened), now);
      },
      4000 + opened * 3000,
    );
}
const world = new HeistWorld(MAP);
const loot = new LootRenderer(scene);
const cacheBeacons = new CacheBeacons(scene);
const chipBeacons = new CacheBeacons(scene, 'chip');

/** Field of view (deg) when not aiming; aiming narrows it by the gun's zoom. */
const BASE_FOV = settings.current.look.fov;
const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 220);
const aimView = new AimView(BASE_FOV);
// Bloom + FXAA. ?fx=high|fxaa|off pins a level; otherwise it starts high and, while frames stay
// over budget, steps down the quality ladder (effects first, then resolution), so slow laptops
// keep their frame rate.
const fxParam = params.get('fx');
const postFx = new PostFx(renderer, scene, camera);
if (fxParam === 'high' || fxParam === 'fxaa' || fxParam === 'off') postFx.setLevel(fxParam);
const quality = fxParam ? undefined : new QualityLadder(window.devicePixelRatio);
/** The player's fixed picture quality; none means automatic (the ladder above). */
let pinnedQuality: QualityRung | undefined;
const fxBudget = quality ? new FrameBudget() : undefined;
// The composer renders several passes a frame; count them all in the overlay.
renderer.info.autoReset = false;
const resize = (): void => {
  const v = computeViewport(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio,
    (pinnedQuality ?? quality?.current)?.maxPixelRatio,
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
// Bank furniture, drawn with the interior kit once it arrives (solid pieces collide either way;
// until then they show as plain boxes).
let interiorKit: InteriorKit | undefined;
if (MAP.banks?.length)
  loadInteriorKit()
    .then((kit) => {
      interiorKit = kit;
      kit.nightGlow.value = lighting.state.night;
      const furniture = buildBankFurniture(kit, MAP);
      scene.add(furniture);
      bankLod.add(furniture);
      hideFurnitureBoxes(mapObject);
    })
    .catch((error: unknown) => console.warn('bank furniture unavailable', error));
const predicted = new PredictedPlayer(player);
const input = new InputSampler(window, undefined, bindings);
input.setLook(spawn.yaw);
// ?at=x,z[,y[,yaw]] starts the player there, to look at a place (offline: a server puts you back).
const atParam = params.get('at')?.split(',').map(Number);
if (atParam && atParam.length >= 2 && atParam.every(Number.isFinite)) {
  const [x = 0, z = 0, y = 0, yaw] = atParam;
  player.teleport(x, y, z);
  if (yaw !== undefined) input.setLook(yaw);
}
const hint = document.createElement('div');
hint.textContent = controlsHint(settings.current, i18n.t);
hint.style.cssText =
  'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);font:14px system-ui;color:#fff;background:#000a;padding:8px 14px;border-radius:6px;pointer-events:none';
document.body.appendChild(hint);
/** Browser storage, when the browser allows it (private windows may not). */
const storage = (() => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
})();
// Newcomers in a real match are pointed at the tutorial until they have finished it once.
const invite = tutorial ? undefined : tutorialInvite(document.body, storage);
const pointer = new PointerLock(renderer.domElement, input, (locked) => {
  hint.hidden = locked;
  if (invite) invite.hidden = locked;
});
const rig = new CameraRig(camera, MAP);
// Behind and above a car, centred (no shoulder), pulled in by walls like the on-foot camera.
const carRig = new CameraRig(camera, MAP, { distance: 7.5, shoulder: 0, pivotHeight: 1.7 });
/** Chase-camera heading: follows the car's with a short lag (rad). */
let chaseYaw: number | undefined;

// Network: ?server=<port> (default 8080) or a full address, ?name=, ?lag=<one-way ms> to simulate latency.
const lag = Number(params.get('lag') ?? 0);
// The lobby says which match (and which port, when matches run in their own threads) to join.
// ?class=<id>: the room a teacher started for that class (the lobby says where it runs).
const gameUrl = tutorial
  ? tutorialUrl(server)
  : classRoom?.state === 'live'
    ? classRoomUrl(server, classRoom.port)
    : await chooseGameUrl(server);
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
const liveWorld = new LiveWorld();
const vehicles = new RemoteVehicles(scene, liveWorld.vehicles);
player.cars = vehicles.footprints();
let myCar: PredictedVehicle | undefined;
let carAssets: CarAssets | undefined;
// A driver's car wears their paint, for everyone to see.
vehicles.paintOf = (driver) => {
  const paint = (driver === client.playerId ? looksTable[String(driver)] : remotes.lookOf(driver))
    ?.paint;
  return paint === undefined ? undefined : carAssets?.painted(paint);
};
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
const rankView = new RankView(document.body);
const skillTree = new SkillTreeView(i18n);
document.body.appendChild(skillTree.root);
const wardrobeView = new WardrobeView(i18n, (slot, id) =>
  client.sendJson({ t: 'set_look', slot, id }),
);
document.body.appendChild(wardrobeView.root);
const contractsView = new ContractsView(i18n);
document.body.appendChild(contractsView.root);
const squadView = new SquadView(i18n, (m) => client.sendJson(m));
document.body.append(squadView.hud, squadView.panel);
const policeStars = new PoliceStars(i18n);
document.body.append(policeStars.root);
const collectionView = new CollectionView(i18n);
document.body.append(collectionView.panel);
const actsView = new ActsView(i18n);
document.body.append(actsView.root);
let intelGuards: readonly { x: number; z: number }[] = [];
const boardView = new BoardView(i18n, (m) => client.sendJson(m));
document.body.append(boardView.panel);
const approachBadge = new ApproachBadge(i18n);
document.body.append(approachBadge.root);
let stealthOn = false;
const jobView = new JobView(i18n);
const jobBeacon = new TutorialBeacon();
scene.add(jobBeacon.object);
document.body.append(jobView.root);
const shopView = new ShopView(i18n, (m) => client.sendJson(m));
document.body.append(shopView.panel, shopView.bar);
/** Rivals the squad's lookout can see (minimap). */
let radarFoes: readonly { x: number; z: number }[] = [];
/** True while the open question is a duel's, so the pop-up is closed when the draw ends. */
let duelTaskOpen = false;
const duelView = new DuelView(i18n, {
  onDraw: () => {
    pointer.release();
    duelTaskOpen = true;
    void sqlTasks.start({ key: 'duel:draw', label: i18n.t('duel.task'), group: 'Duel' });
  },
  onEnd: () => {
    if (!duelTaskOpen) return;
    duelTaskOpen = false;
    sqlPanel.close();
  },
});
document.body.appendChild(duelView.root);
// The street crowd (Phase 29.1): scenery on the sidewalks, who run from gunfire. Not part of the game.
const crowdSettings = () => liveWorld.atmosphere.crowd;
const crowd =
  MAP.city && crowdSettings().count > 0
    ? new CrowdModel(MAP.city, crowdSettings, String(MAP.id ?? 'city'))
    : undefined;
const crowdArt = crowd ? new CrowdRenderer(scene, crowd, crowdSettings) : undefined;
const leagueView = new LeagueView(i18n);
document.body.appendChild(leagueView.root);
/** How everyone looks, as the server last said (cosmetics). */
let looksTable: Readonly<Record<string, LookView>> = {};
const bankingProgress = new BankingProgress(hud);
// The minimap: every bank's vault progress (flashing while its alarm rings), safehouses, loose cash.
const minimap = new MinimapView(hud.root, MAP);
// The full-screen map (M): the whole city, north up; the game keeps running behind it.
const fullMap = new FullMapView(document.body, MAP);
// Your profile (P): two live radars. At the end of a round a card shows this round over all time.
const profileAll = new ProfileView('all');
const profilePanel = h('div', { class: 'profile-panel', attrs: { hidden: '' } }, profileAll.root);
const review = new ReviewView();
const shareCard = new ShareCardView(i18n);
const reviewPanel = h(
  'div',
  { class: 'profile-panel', attrs: { hidden: '' } },
  shareCard.root,
  review.root,
);
// The round card is drawn from what this player already sees, once the round has ended.
let roundsSeen = 0;
let lastRoundEnd: Extract<RoundMessage, { phase: 'ended' }> | undefined;
let lastReview: ReviewMessage | undefined;
let shareConfig: ProgressMessage['share'];
const refreshShareCard = (): void => {
  const end = lastRoundEnd;
  const mine = end?.standings.find((s) => s.id === client.playerId);
  if (!end || !mine || !shareConfig) return;
  shareCard.update(
    {
      name: mine.name,
      round: lastReview?.round ?? roundsSeen,
      rank: end.standings.indexOf(mine) + 1,
      players: end.standings.length,
      banked: mine.banked,
      kills: mine.kills,
      awards: end.awards.filter((a) => a.playerId === client.playerId),
      items: lastReview?.items ?? [],
    },
    shareConfig,
  );
};
const profileRound = new ProfileView('round');
const profileCard = h(
  'div',
  { class: 'profile-card-round', attrs: { hidden: '' } },
  profileRound.root,
);
document.body.append(profilePanel, profileCard, reviewPanel);
let latestProfile: ProfileMessage | undefined;
const hospital = hospitalMarker(MAP);
const vaultAlerts = new VaultAlerts(DEFAULT_AUDIO_SETTINGS.alarmSeconds);
/** Redraw the minimap at most this often (ms): it is a glance, not a view. */
const MINIMAP_EVERY_MS = 33;
let lastMinimap = 0;
/** Who has a bounty on them, as last posted by the server. */
let wanted: readonly WantedView[] = [];
const scoreboard = new ScoreboardView(document.body, () => client.playerId);
const roundUi = new RoundUi(scoreboard);
const tracers = new Tracers(scene);
// The tutorial's card and its "go here" beacon; the server says which step the player is on.
const guide = tutorial
  ? new TutorialGuide(document.body, {
      onPlay: () => (location.search = realMatchSearch(location.search)),
      storage,
    })
  : undefined;
const beacon = tutorial ? new TutorialBeacon() : undefined;
if (beacon) scene.add(beacon.object);
let objective: { readonly x: number; readonly y: number; readonly z: number } | undefined;
let tutorialStep = 0;
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
const hud0 = new CaptionView(document.body, undefined, undefined, undefined, i18n.t);
const heard = new CaptionedAudio(
  sound,
  (caption) => hud0.show(caption),
  () => settings.current.access.subtitles,
);
setInterval(() => hud0.tick(), 500);
const audio = new GameAudio({
  out: heard,
  settings: DEFAULT_AUDIO_SETTINGS,
  vehicles: liveWorld.vehicles,
  map: MAP,
  myId: () => client.playerId,
  positionOf: (id) => remotes.positionOf(id),
  weaponOf: (id) => remotes.weaponOf(id),
});
// The guns' numbers: the server sends its own on join (an admin may have retuned them).
const weaponTable = new WeaponTable();
const feedback = new CombatFeedback({
  hud,
  tracers,
  map: MAP,
  movement: DEFAULT_MOVEMENT_SETTINGS,
  combat: DEFAULT_COMBAT_SETTINGS,
  weapons: weaponTable,
  onLocalShot: (weapon) => {
    model.fired();
    audio.localShot(weapon);
    // Recoil: the view jumps; pulling it back down is the player's job.
    input.kick(weaponTable.get(weapon)?.recoil ?? 0);
  },
  onDryFire: () => audio.dryFire(),
  myId: () => client.playerId,
  myName: () => playerName,
  nameOf: (id) => remotes.nameOf(id),
  positionOf: (id) => remotes.positionOf(id),
});
// Connect only once everything that reacts to the server exists: the first messages (welcome, vault and
// loot state) arrive right after joining and would be dropped if nobody were listening yet.
// Signed in? The account service gives a one-use ticket; the server then takes the name from the account.
const ticket = await account.ticket(classId);
let transport: GameTransport = new WebSocketGameTransport(gameUrl);
if (lag > 0) transport = new DelayedTransport(transport, lag);
const client = new GameClient(transport, {
  name: params.get('name') ?? 'Player',
  ...(ticket ? { ticket } : {}),
});
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
    if (event.e === 'shot') {
      // Gunfire sends the crowd running: from the shooter, or from where you stand when it is you.
      const from = event.shooter === client.playerId ? drawPos : remotes.positionOf(event.shooter);
      if (from) crowd?.alarm(from.x, from.z);
    }
  },
  closed: (reason) => {
    // The server said why (round under way, match full, out of date): show it and stay on screen.
    hint.hidden = false;
    hint.textContent = `Disconnected: ${reason}. ${
      /sign in|ticket/i.test(reason)
        ? 'Open the menu (remove everything after the address) to sign in.'
        : 'Reload the page to try again.'
    }`;
  },
  json: (message) => {
    if (challengeApi.handle(message) || interactions.handle(message)) return;
    if (vehicleControls.handle(message)) return;
    if (message.t === 'vaults') {
      world.applyVaults(message.vaults);
      audio.onVaults(message.vaults);
      vaultAlerts.observe(message.vaults, performance.now() / 1000);
      vaultArt?.onVaults(message.vaults, performance.now() / 1000);
    } else if (message.t === 'round') {
      if (message.phase === 'playing') {
        roundsSeen++;
        lastReview = undefined;
      } else {
        lastRoundEnd = message;
        refreshShareCard();
      }
      // The tutorial has no round to race: its room closes long before the clock would matter.
      if (!tutorial) roundUi.onRound(message, performance.now());
      // The round-end card: this round over everything so far, until the next round begins.
      profileCard.hidden = message.phase !== 'ended' || !latestProfile?.round;
      // Between rounds a signed-in player can plan the next heist (an open brief a teacher marks).
      if (message.phase === 'ended' && ticket && !tutorial)
        scoreboard.setAction('Plan the next heist ✎', () => {
          pointer.release();
          void sqlTasks.start({
            key: 'brief:plan',
            label: rewardLabel('brief:plan'),
            group: 'Plan',
          });
        });
      else scoreboard.setAction(null);
    } else if (message.t === 'scores') roundUi.onScores(message);
    else if (message.t === 'standing') roundUi.onStanding(message);
    else if (message.t === 'arms') {
      ownedWeapons = message.owned;
      hud.setArms(message.owned, message.current);
    } else if (message.t === 'weapons') weaponTable.set(message.weapons);
    else if (message.t === 'review') {
      review.update(message);
      lastReview = message;
      refreshShareCard();
      hud.toast('Round review ready — press V');
    } else if (message.t === 'duel') {
      duelView.update(message);
    } else if (message.t === 'acts') {
      actsView.update(message, performance.now());
    } else if (message.t === 'intel_guards') {
      intelGuards = message.guards;
    } else if (message.t === 'approach_state') {
      stealthOn = message.mode === 'stealth';
      approachBadge.update(message);
    } else if (message.t === 'job') {
      jobView.update(message, performance.now());
      const next = message.status === 'active' ? message.targets[message.index] : undefined;
      objective = next ? { x: next.x, y: 0, z: next.z } : undefined;
      jobBeacon.setTarget(objective);
      if (message.status === 'claim') openTask(`job:${message.kind}`, '');
    } else if (message.t === 'discovery') {
      fullMap.explored = new Set(message.districts);
    } else if (message.t === 'caches') {
      cacheBeacons.apply(message.caches);
      if (message.found)
        hud.toast(`Hidden cache found! +$${message.found.amount.toLocaleString('en-US')}`);
    } else if (message.t === 'collection') {
      chipBeacons.apply(message.near);
      collectionView.update(message);
      const card = message.found.find((f) => f.id === message.latest);
      if (card) hud.toast(`Data chip: ${card.title}`);
    } else if (message.t === 'shop') {
      shopView.update(message);
    } else if (message.t === 'police') {
      policeStars.update(message);
    } else if (message.t === 'squad') {
      squadView.update(message);
      scoreboard.mySquad = message.squad;
    } else if (message.t === 'radar') {
      radarFoes = message.foes;
    } else if (message.t === 'season') {
      wardrobeView.updateSeason(message);
    } else if (message.t === 'league') {
      leagueView.update(message);
    } else if (message.t === 'contracts') {
      contractsView.update(message);
      if (message.completed?.length) hud.toast(i18n.t('contracts.completed'));
    } else if (message.t === 'wardrobe') {
      wardrobeView.update(message);
    } else if (message.t === 'looks') {
      looksTable = message.looks;
      remotes.setLooks(message.looks);
      model.setLook?.(looksTable[String(client.playerId)] ?? {});
    } else if (message.t === 'skills') {
      skillTree.update(message.skills);
    } else if (message.t === 'progress') {
      rankView.update(message);
      if (message.share) shareConfig = message.share;
    } else if (message.t === 'profile') {
      latestProfile = message;
      profileAll.update(message);
      profileRound.update(message);
    } else if (message.t === 'world') {
      liveWorld.apply(message);
      setRewardIcons(message.rewardIcons);
    } else if (message.t === 'feed') {
      const line = feedText(message.item, client.playerId);
      hud.addEvent(line.text, line.tone);
    } else if (message.t === 'bounties') wanted = message.wanted;
    else if (message.t === 'banking') bankingProgress.handle(message, performance.now());
    else if (message.t === 'loot') loot.apply(message.add, message.remove);
    else if (message.t === 'purse') {
      hud.setPurse(message.carried, message.banked);
      audio.onPurse(message.carried, message.banked);
      player.speedScale = message.speed;
      model.setCarrying(message.carried > 0 || params.has('bag'));
    } else if (message.t === 'notice') hud.toast(message.text);
    else if (message.t === 'tutorial') {
      if (message.step > tutorialStep)
        hud.toast(`Done: ${TUTORIAL_STEPS[message.step - 1]?.title ?? 'step'}`);
      tutorialStep = message.step;
      guide?.show(message.step);
      objective = tutorialTarget(message.step);
      beacon?.setTarget(objective);
      // The last card has a button: give the mouse back to press it.
      if (message.step >= TUTORIAL_STEPS.length) pointer.release();
    }
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
    magSize: weaponTable.get(weapon)?.magSize ?? 0,
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
function openTask(rewardKey: string, target: string): void {
  // The panel needs the mouse (the world keeps running behind it).
  pointer.release();
  void sqlTasks.start({
    key: rewardKey,
    label: rewardLabel(rewardKey),
    group: rewardKey.split(':')[0] ?? 'Task',
    target,
  });
}
const interactions = new Interactions({
  map: MAP,
  send: (message) => client.sendJson(message),
  view: hud,
  onOpenBoard: (board, kinds) => {
    pointer.release();
    boardView.open(board, kinds);
  },
  onOpenShop: () => {
    pointer.release();
    shopView.open();
  },
  onOpenTask: (rewardKey, target) => openTask(rewardKey, target),
});
// F uses what is in reach; the number keys hold a gun you own (the server confirms in the next snapshot).
const settingsPanel = new SettingsPanel(settings, i18n);
const hotkeys = new Hotkeys(window, bindings)
  .onAction('tasks', () => {
    pointer.release();
    sqlTasks.pick();
  })
  .holdAction('scoreboard', (down) => scoreboard.setBoardVisible(down))
  .onAction('map', () => fullMap.toggle())
  .onAction('review', () => {
    reviewPanel.hidden = !reviewPanel.hidden;
  })
  .onAction('profile', () => {
    profilePanel.hidden = !profilePanel.hidden;
    if (latestProfile) profileAll.update(latestProfile);
  })
  .onAction('skills', () => {
    pointer.release();
    skillTree.hidden = !skillTree.hidden;
  })
  .onAction('squad', () => {
    pointer.release();
    squadView.hidden = !squadView.hidden;
  })
  .onAction('approach', () =>
    client.sendJson({ t: 'approach', mode: stealthOn ? 'loud' : 'stealth' }),
  )
  .onAction('collection', () => {
    pointer.release();
    collectionView.hidden = !collectionView.hidden;
  })
  .onAction('league', () => {
    pointer.release();
    leagueView.hidden = !leagueView.hidden;
  })
  .onAction('contracts', () => {
    pointer.release();
    contractsView.hidden = !contractsView.hidden;
  })
  .onAction('wardrobe', () => {
    pointer.release();
    wardrobeView.hidden = !wardrobeView.hidden;
  })
  .onAction('settings', () => {
    pointer.release();
    settingsPanel.toggle();
  })
  .bind(['Escape'], () => {
    fullMap.setOpen(false);
    profilePanel.hidden = true;
    reviewPanel.hidden = true;
    skillTree.hidden = true;
    wardrobeView.hidden = true;
    contractsView.hidden = true;
    leagueView.hidden = true;
    squadView.hidden = true;
    shopView.hidden = true;
    boardView.hidden = true;
    collectionView.hidden = true;
  })
  .onAction('radio', () => {
    if (!myCar) return;
    const n = audio.nextStation();
    hud.toast(
      n === 0 ? i18n.t('radio.off') : `♪ ${DEFAULT_AUDIO_SETTINGS.radioNames[n - 1] ?? ''}`,
    );
  })
  .onAction('mute', () => hud.toast(sound.toggleMute() ? 'Sound off' : 'Sound on'))
  .onAction('use', () => {
    if (!feedback.isAlive) return;
    // A lift, vault or safehouse in reach comes first; otherwise the key is for cars.
    if (vehicleControls.available && !interactions.hasTarget) void vehicleControls.use();
    else void interactions.use();
  });
// The number keys hold a gun you own (the server confirms in the next snapshot).
WEAPON_IDS.forEach((weapon, i) =>
  hotkeys.onAction(`weapon${i + 1}` as 'weapon1', () => {
    if (ownedWeapons.includes(weapon)) client.sendJson({ t: 'equip', weapon });
  }),
);
// A connected controller plays through the same actions (Phase 22.4).
const gamepad = new GamepadAdapter(
  () => (navigator.getGamepads ? [...navigator.getGamepads()] : []),
  input,
  { trigger: (a) => hotkeys.trigger(a), setHeld: (a, down) => hotkeys.setHeld(a, down) },
  () => settings.current.gamepad,
  (step) => {
    // The next gun you own, wrapping round.
    for (let i = 1; i <= WEAPON_IDS.length; i++) {
      const slot =
        (((heldWeapon - 1 + step * i) % WEAPON_IDS.length) + WEAPON_IDS.length) % WEAPON_IDS.length;
      const weapon = WEAPON_IDS[slot];
      if (weapon && ownedWeapons.includes(weapon)) {
        client.sendJson({ t: 'equip', weapon });
        return;
      }
    }
  },
);
// On-screen controls for touch devices (Phase 22.5); shown by the settings and the device.
const touch = new TouchControls(
  document.body,
  input,
  { trigger: (a) => hotkeys.trigger(a), setHeld: (a, down) => hotkeys.setHeld(a, down) },
  () => settings.current,
  i18n,
);
// Settings that need pushing into the running game (the rest read the store when they need it).
const applySettings = (): void => {
  const s = settings.current;
  input.setLookPreferences(s.look.sensitivity, s.look.invertY);
  aimView.setBaseFov(s.look.fov);
  sound.setChannelVolume('master', s.audio.master);
  sound.setChannelVolume('effects', s.audio.effects);
  sound.setChannelVolume('ambience', s.audio.ambience);
  hint.textContent = controlsHint(s, i18n.t);
  touch.refresh();
  if (!fxParam) {
    pinnedQuality = s.graphics.quality === 'auto' ? undefined : QUALITY_PRESETS[s.graphics.quality];
    postFx.setLevel((pinnedQuality ?? quality?.current)?.fx ?? 'high');
    resize();
  }
};
settings.subscribe(applySettings);
i18n.onChange(applySettings);
applySettings();
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
      liveWorld.vehicles.kinds[server.kind],
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
  if (quality && !pinnedQuality && fxBudget?.push(frameMs) && quality.stepDown()) {
    postFx.setLevel(quality.current.fx);
    resize();
    console.info(
      `frames over budget: quality down to ${quality.current.fx} at ${quality.pixelRatio}× pixels`,
    );
  }
  gamepad.update(frameMs / 1000);
  input.setViewLag(client.rttMs / 2 + INTERP_DELAY_MS);
  loop.advance(frameMs / 1000);
  batcher.flush(now);
  predicted.smooth(frameMs / 1000);
  tracers.update(frameMs / 1000);
  loot.update(now / 1000);
  cacheBeacons.update(now / 1000);
  chipBeacons.update(now / 1000);
  beacon?.update(now / 1000);
  jobBeacon.update(now / 1000);
  jobView.frame(now);
  actsView.frame(now);
  vaultArt?.update(now / 1000, frameMs / 1000, (id) => vaultAlerts.isAlert(id, now / 1000));
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
  // Aiming: the view zooms to the held gun's zoom (a scope at 3× and more), and look slows with it.
  const held = weaponTable.get(WEAPON_IDS[heldWeapon - 1]);
  const aiming = input.aiming && feedback.isAlive && !myCar && held !== undefined;
  if (aiming) model.raise();
  const fov = aimView.update(aiming ? held.aimZoom : 1, frameMs / 1000);
  if (Math.abs(camera.fov - fov) > 1e-3) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  input.setLookScale(aimView.lookScale);
  hud.setScoped(aimView.scoped);
  // Through a scope your own body would fill the view.
  model.object.visible = feedback.isAlive && !myCar && !aimView.scoped;
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
    hourAt(serverClock.ready ? serverClock.serverTimeAt(now) : 0, liveWorld.atmosphere);
  if (Math.abs(hour - lighting.state.hour) > SKY_STEP_HOURS) {
    lighting.apply(skyAt(hour));
    postFx.setNight(lighting.state.night);
    if (cityKit) setNightGlow(cityKit.materials, lighting.state.night);
    if (carAssets) carAssets.nightGlow.value = lighting.state.night;
    if (interiorKit) interiorKit.nightGlow.value = lighting.state.night;
    facades?.setNight(lighting.state.night);
    decor?.setNight(lighting.state.night);
  }
  bankLod.update(player.body.x, player.body.y, player.body.z);
  camera.getWorldDirection(earForward);
  earUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  // Weather from the same clock as the sky (?weather=clear|fog|rain|storm pins it).
  const weather = pinnedWeather(
    weatherPin,
    weatherAt(serverClock.ready ? serverClock.serverTimeAt(now) : 0, MAP.id, liveWorld.atmosphere),
  );
  weatherFx.set(weather);
  audio.update({
    rain: weather.rain,
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
  if (now - lastMinimap >= MINIMAP_EVERY_MS) {
    lastMinimap = now;
    // Turned the way the camera looks (behind the car when driving).
    const me = { x: drawPos.x, z: drawPos.z, yaw: Math.atan2(-earForward.x, -earForward.z) };
    const markers = [
      ...markersFor(
        MAP,
        world.vaults,
        loot.positions(),
        vaultAlerts,
        now / 1000,
        wanted,
        client.playerId,
      ),
      ...[...cacheBeacons.positions()].map((c): Marker => ({
        kind: 'cache',
        id: `cache-${c.id}`,
        x: c.x,
        z: c.z,
        pinned: false,
      })),
      ...[...chipBeacons.positions()].map((c): Marker => ({
        kind: 'cache',
        id: `chip-${c.id}`,
        x: c.x,
        z: c.z,
        pinned: false,
      })),
      ...mateMarkers(squadView.members),
      ...foeMarkers(radarFoes),
      ...foeMarkers(intelGuards),
      ...(objective ? [objectiveMarker(objective)] : []),
    ];
    minimap.draw(me, markers, now / 1000);
    if (fullMap.isOpen) fullMap.draw(me, hospital ? [...markers, hospital] : markers, now / 1000);
  }
  crowdArt?.update(drawPos, frameMs / 1000);
  lighting.frame(camera);
  weatherFx.frame(frameMs / 1000, camera);
  lighting.follow(myCar ? myCar.model.object : model.object);
  postFx.render(scene, camera);

  if (now - lastOverlay > 500) {
    lastOverlay = now;
    const { calls, triangles } = renderer.info.render;
    overlay.textContent = `${client.status} · rtt ${client.rttMs.toFixed(0)} ms · players ${remotes.count + 1} · pending ${predicted.pendingCount} · corr ${predicted.lastCorrection.toFixed(3)} m · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(0)} ms · ${calls} calls · ${(triangles / 1000).toFixed(1)}k tris · fx ${postFx.level} @${renderer.getPixelRatio()}×`;
  }
});
