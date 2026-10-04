# Frontend (client)

Stack: TypeScript, Vite, Three.js, CodeMirror 6 (SQL). No UI framework for the HUD (plain DOM + small helpers) to protect bundle size.

## Budgets
| Item | Budget |
|---|---|
| First load (gz) | < 8 MB (code < 1 MB, assets streamed) |
| Frame rate | 60 fps integrated GPU, 30 fps floor on low-end |
| Draw calls | < 200 |
| Triangles on screen | < 400k |
| Textures | city: one texture array (512 px layers, WebP) + a decal sheet; max 2k |
| Audio | sprite sheets < 1 MB total |

## Modules
```
src/
  main.ts            composition root: wires dependencies, starts the game state machine
  render/            renderer, camera rig, post-fx (bloom, FXAA), sky, day-night, fog
  world/             seeded city generator, chunk streaming, bank interiors, colliders
  entities/          LocalPlayer, RemotePlayer, Vehicle, Weapon, Loot
  input/             keyboard/mouse/pointer-lock → InputCommand queue, rebinding
  net/               ws client, binary codec (from shared/), prediction, interpolation
  ui/                HUD, minimap, quick menu, killfeed, scoreboard
  ui/sql/            SQL pop-up (below)
  audio/             spatial Web Audio, sprite player
```

## Patterns used (why / how) — see design-principles.md
- **State**: `GameScreenState` (Menu, Lobby, InMatch, Results) and `PlayerViewState` (Alive, Dead, InVehicle, Solving) — each state owns which inputs/UI are active.
- **Command**: input becomes `InputCommand` objects with sequence numbers → enables prediction, replay on reconciliation, rate limiting.
- **Observer**: `ClientEventBus` (damage taken, challenge received, kill) so HUD, audio, and camera shake react without knowing each other.
- **Strategy**: `CameraMode` (OnFoot, Vehicle, Spectator), `InterpolationPolicy`.
- **Object Pool**: vectors, decals, tracers, particles, snapshot decode targets.
- **Adapter**: `WsTransport` over WebSocket so tests use a fake transport.
- **Facade**: `SqlPanelController` hides the panel's editor/net/draft details from the rest of the UI.
- **Dependency Inversion**: classes receive `Transport`, `Clock`, `Renderer` interfaces from the composition root.

## Rendering approach ("real-life look, light cost")
- Art direction: stylised-realistic, muted palette, strong lighting, fog depth.
- City from the Quaternius kit (`city-kit.md`): kit pieces merged per chunk per material (2 materials: opaque texture array chosen per vertex, and decals; `world/city/CityKit.ts`, preview page `kit.html`), fake-interior windows on non-bank buildings, far chunks as impostors. Gameplay never reads art meshes: the layout's boxes do.
- Baked AO/lightmaps on banks; one dynamic sun; shadows only within ~60 m of player.
- Sky gradient + sun disc; day/night by lerping light, fog, emissive windows/streetlights.
- Wet roads at night via cheap env-probe reflection.
- Post: FXAA + light bloom only. No SSAO/SSR.
- LOD: 3 levels for buildings; far chunks as imposters.
- Characters: ~3k tri rigged student, palette swap; shared skeleton and clips (idle, walk, run, crouch, aim, shoot, reload, hit, death, drive).

## Camera & controls
Third-person over-the-shoulder; pointer lock; WASD, Shift sprint, Ctrl crouch, Space jump, LMB shoot, RMB aim, R reload, F interact/enter vehicle, **Tab quick menu**, M map. Local player is predicted; remote players interpolated (100 ms buffer).

## SQL pop-up (key feature) — built in Phase 4
Non-blocking right-side panel (~46% width on desktop, full screen under 760 px); the world keeps rendering and the player stays vulnerable. Code: `client/src/ui/sql/`, demo page `client/sql-demo.html` (spinning cube + real server).

| Piece | File | Job |
|---|---|---|
| Shell | `SqlPanel.ts` | frame, open / minimise (slim bar) / close, observable state (game can auto-crouch) |
| Controller (Facade) | `SqlPanelController.ts` | the one object the game calls: `start(task)`; owns timer, lockout, hints, drafts |
| Problem pane | `ProblemPane.ts` | story (shared inline-Markdown tokens → elements, never innerHTML), tables with sample rows, hints |
| Work pane | `WorkPane.ts`, `SqlEditor.ts`, `ResultView.ts` | CodeMirror SQL editor, Run / Submit / Hint, preview rows and verdicts |
| Task switcher | `TaskSwitcher.ts`, `DraftStore.ts` | header menu of tasks; per-task drafts kept (memory or sessionStorage) |
| Network | `net/ChallengeApi.ts`, `net/WebSocketChallengeApi.ts` | interface + WebSocket adapter (connect on demand, ref matching, timeouts, server-clock sync) |

Behaviour (all decided by the server, shown by the client):
- **Run** = free preview of the first rows, rate-limited. **Submit** = graded. A wrong answer locks Submit for the server-set time ("Locked 8 s"); Run still works so you can fix the query.
- **Hint** button names the next hint's cost before you click it (percent of carried cash or a fixed amount, per the server's `hintCostMode`); hints open in order; the game is told once per first reveal so it deducts the cost.
- **Switch task** asks for a new question (the old one is dropped), while what you typed per task is remembered.
- **Timer** counts down to the server's deadline in the header and on the minimised bar (red under 30 s). Running out costs nothing; the panel says so and offers a new question. Closing the panel abandons the task; minimising keeps it.
- **Keys:** Ctrl/⌘+Enter run, Ctrl/⌘+Shift+Enter submit, Esc in the editor leaves it, Esc elsewhere in the panel minimises (focus returns to the game).
- **Resizable:** drag the panel's left edge (width), the divider between task and editor (split), or the bar under the editor (editor height). Arrow keys on a focused handle nudge it, double-click or Home resets. Sizes are remembered in localStorage. Under 760 px the layout is stacked and the handles are hidden.
- **Icons:** each reward shows a game-icons.net silhouette (CC BY 3.0, see `docs/credits.md`) on a tile whose border colour is the question tier. They appear in the panel header, the minimised bar and the task switcher, which is an icon grid rather than a native select. The reward → icon map is presentation-only, like `labels.ts`.
- Hooks for the game: `onSolved({rewardKey, target})`, `onHintCharged(hint)`, `panel.onStateChange(...)`.

Measured size (gzipped, `npm run size`): client code ≈ 266 kB for the demo page (Three.js ≈ 128 kB, panel + CodeMirror ≈ 137 kB) against a 1 MB code budget; the check runs in CI.

## Game client — built in Phase 5
Entry: `client/src/main.ts` (composition root); try it with the server running: `npm run dev:server`, `npm run dev:client`, open http://localhost:5173 (add `?lag=50` for 50 ms each way, `?name=`, `?server=<port>`; `npm run bot -w @heist/server -- 3` adds walking bots).

| Piece | Files | Job |
|---|---|---|
| Map + light | `world/MapRenderer.ts`, `render/lighting.ts` | instanced boxes per kind from the shared map, one shadow sun that follows the player, fog |
| Input (Adapter, Command) | `input/InputSampler.ts`, `input/PointerLock.ts` | keys/mouse → one quantised `InputCommand` per 60 Hz tick; click captures the mouse; typing in the SQL editor never moves the player |
| Loop | `game/FixedStepLoop.ts` | simulation in fixed 1/60 s steps whatever the frame rate |
| Prediction | `game/LocalPlayer.ts`, `game/PredictedPlayer.ts` | runs the shared movement step locally; on each snapshot rewinds to the server state and replays unacknowledged input; real corrections glide, teleports snap |
| Camera (Strategy) | `render/CameraRig.ts` | over-the-shoulder, pulls in against walls, same pivot the server shoots from |
| Character (Strategy, Factory) | `entities/CharacterRig.ts`, `GltfCharacter.ts`, `characterAssets.ts`, `animation.ts`, `CharacterModel.ts` | rigged human (Quaternius, CC0): ~5k triangles, 3 draw calls, shared animation clips cross-faded by motion, per-player shirt/trousers/shoes colours and skin tone painted in the shader by a per-vertex region code. `CharacterModel` (six boxes) remains as the fallback if the files fail to load |
| Network (Adapter, Decorator, Observer) | `net/GameTransport.ts`, `net/GameClient.ts`, `net/InputBatcher.ts`, `net/SnapshotClock.ts` | binary WebSocket, RTT ping, ~30 input batches/s, server-clock estimate; `DelayedTransport` adds artificial lag |
| Remote players | `net/SnapshotInterpolator.ts`, `entities/RemotePlayers.ts` | per-player snapshot buffer drawn 100 ms in the past, blended between real snapshots |
| Combat feedback | `game/CombatFeedback.ts`, `render/Tracers.ts` (Object Pool), `ui/hud/Hud.ts` | own trail drawn at once, others' from server events; hit marker, damage flash, kill feed, death screen. Presentation only |

Shooting practice: the server spawns `sandboxDummies` (default 2) stationary dummies that respawn where they stand; add `?debug` to the URL to draw every other player's server hit-box (green body, red head slice).

Frame budget now: ~37 draw calls and ~65k triangles (shadow pass included) with six characters; bundle ~295 kB gzipped plus ~1 MB of character files (`client/public/characters/`, built by `tools/characters/`). See backlog for the low-detail model plan.

## Testing
Unit (Vitest): codec, interpolation, prediction. UI: Playwright smoke for pop-up flow against a mock server. Perf: scripted fly-through logs fps/draw calls via `renderer.info` (Phase 8+).

## In-game heist UI (Phase 7)
- **Keys:** F uses what is in reach (lift, vault console, safehouse; a prompt shows when something is), Tab opens the task menu ("what do you need?"), 1–5 hold a gun you own. `Hotkeys` handles these one-shot presses (ignored while typing in the SQL editor); movement stays in `InputSampler`.
- **Task menu:** the SQL panel's Switch menu is fed by `buildTaskOptions(situation)` each time it opens: heals (greyed at full health), guns (greyed if owned), ammo refill (greyed if no gun or magazine full) and the next lock of a vault in reach. Greyed items say why. The server re-checks every request, so the menu only saves a wasted round trip. Picking a task switches to a new question; the panel never pauses the world.
- **HUD:** health bar, cash carried and banked, weapon bar (owned guns as icon slots numbered by key, the held one lit, rounds left), interaction prompt, banking progress bar, toasts.
- **World:** loot bags bob in the world, players carrying cash wear a bag on their back (snapshot flag), vault doors are separate meshes hidden when the vault opens, glowing pads mark lifts, consoles and safehouses.

## City art (Phase 8.3)
The generated city (`map.city`, see backend.md "The city") is drawn from kit pieces, client side only. Collisions never depend on it.
1. **Plan:** `planCity(layout, BANK_LAYOUTS)` → one `ChunkPlan` per block. A plan is pure data: kit placements (piece, position, quarter turn, chosen window interior), horizontal `GroundQuad`s and vertical `WallQuad`s. It is seeded from the city seed, so every client draws the same facades. A chunk owns its block plus the streets to its north and west; the last row and column also own the outer ring.
   - **Ground:** asphalt (the chunk minus the block), sidewalk tops at kerb height with kerb faces on both edges, paving in alleys and lots, and marble on plazas and safehouses. All of it uses world-space UVs, so the tiling has no seams.
   - **Road markings:** double-yellow centre lines and a wide crosswalk at both ends of every street segment.
   - **Props:** planters on plazas and AC units on roofs.
2. **Facade grammar (`facades.ts`, Interpreter):** a building picks a style (brick, metal, trim: wall, window, ground wall, shop window, cornice) and a window rhythm (`WP`, `WWP`, `WPP`). Every 2 m module of every storey gets one piece, and a cornice runs along the roof line.
   - **Street sides** get windows and shop fronts. Each window shows one of three fake-interior layers, chosen per window.
   - **Alley sides** are plain walls.
   - **Shared walls:** storeys hidden behind an equal-or-taller neighbour are skipped.
   - **Bank 1** gets a trim facade pushed 0.22 m out so it shows outside its collider walls, with the ground floor left open at the entrance. Its collider roof and interior are still drawn as boxes. Bank sites without a layout are closed trim buildings.
   - **Triangle choices:** the kit's own trim window (556 triangles) and trim cornice (112) are swapped for the metal ones (210, 30).
3. **Merge (`buildChunkGeometry`, Builder):** every placement is copied into one opaque geometry (texture-array layer per vertex) and one decal geometry per chunk. `buildCityArt` puts each chunk in a group named `chunk-ix-iz` whose `userData.bounds` holds the ground it covers (used by 8.4 streaming).

Default city: 25 chunks, about 0.9M triangles if every chunk were drawn in detail, which is why it is streamed (below). The game starts with the box stand-ins and swaps in the kit art when it loads (`hideKitCovered` hides `shell`/`kerb` boxes and the plain ground). If the kit fails to load, the boxes stay. Preview: `kit.html?city` (whole city) or `kit.html?block=0,0` (one block; Bank 1 is in block 0,0 of the default seed).

## Streaming and LOD (Phase 8.4)
`CityStreamer` (`CityRenderer.ts`, Proxy) draws only what the camera needs:
- **Detail range:** a chunk within 72 m of the camera (measured to the chunk's nearest edge) shows its full kit geometry. It stays detailed until it is 86 m away; the gap stops chunks flickering at the boundary.
- **Impostors:** other chunks show an impostor, which is their ground and kerbs plus each building as a textured box with a roof (about 10 triangles, wall layer from the style's `massLayer`). Impostors cast no shadows; the shadow map only covers about 45 m anyway.
- **Draw range:** past 230 m nothing is drawn, because the fog has already hidden it.
- **Building detail:** a chunk's detail is built on demand, at most one per frame, and kept afterwards. `prime()` builds everything around the spawn before the first frame.

Measured on the default city from the centre: 9 detailed and 40 impostor chunks, 58 draw calls for the whole city. That count includes the **outskirts**, a ring of facade buildings 20 m deep just outside the city wall, facing in (`planOutskirts`). With them in place, the wall boxes are hidden (`hideKitCovered` hides `map-wall` too); the wall collider is still there.

**Character LOD:** each character file carries a light `*_LOD` copy of body and hair on the same skeleton (`tools/characters/build-lod.mjs`): 1.5k/1.9k triangles instead of 4.9k/5.7k, with no eyes. `RemotePlayers` switches a player to it beyond 26 m from the camera, and back inside 24 m. `?lowpoly` shows your own player with it.

Preview: `kit.html?city&lod` shows the city as streamed from its centre, with fog off.

## Day and night (Phase 8.5)
- **The clock:** the hour comes from the match clock, so every player sees the same sky and nothing new is sent. `hourAt(serverMs, AtmosphereSettings)` uses `dayMinutes` (30) and `startHour` (9) from `shared/src/config/atmosphere.ts` (defaults only), so a 15-minute round runs from morning into the evening.
- **The sky model:** `skyAt(hour)` (`render/dayNight.ts`, pure) blends keyframes (night, pre-dawn, dawn, morning, noon, afternoon, dusk, evening) into a `SkyState`, which holds:
  - the light's colour, intensity and direction (the sun by day; the moon, opposite it, by night; never below 0.25 elevation, so shadows stay finite);
  - the hemisphere fill;
  - the zenith and horizon colours;
  - the fog range (closer at night);
  - a `night` factor.
  Nights keep at least 0.5 ambient so they stay playable.
- **Applying it:** `Lighting.apply(state)` sets the shadow light, the fill and the fog. The fog colour is the horizon colour, so far buildings melt into the sky.
- **The dome:** `SkyDome` draws a gradient around the camera with a sun disc and halo by day, and a moon and stars by night. It is one draw call, ignores fog, and stays inside the 220 m far plane.
- **Lit windows:** at night the fake-interior window layers of the lit offices glow. The kit shader adds `uNightGlow` × texture as emission for the layers in `uLitLayers`; the dark-office layer stays dark.
- **Cost:** the game re-applies the sky only when the hour has moved by 0.005 h (about 10 s of a 30-minute day).

`?hour=22` pins the time of day in the game (and in `kit.html`) for screenshots. Overriding `dayMinutes` from the admin is deferred: the client would need to receive it, like the city seed.
