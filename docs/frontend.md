# Frontend (client)

Stack: TypeScript, Vite, Three.js, CodeMirror 6 (SQL). No UI framework for the HUD (plain DOM + small helpers) to protect bundle size.

## Budgets
| Item | Budget |
|---|---|
| First load (gz) | < 8 MB (code < 1 MB, assets streamed) |
| Frame rate | 60 fps integrated GPU, 30 fps floor on low-end |
| Draw calls | < 200 |
| Triangles on screen | < 400k |
| Textures | atlas + KTX2/Basis; max 2k |
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
- Buildings/props via `InstancedMesh`; merged static geometry per chunk.
- Baked AO/lightmaps on banks; one dynamic sun; shadows only within ~60 m of player.
- Sky gradient + sun disc; day/night by lerping light, fog, emissive windows/streetlights.
- Wet roads at night via cheap env-probe reflection.
- Post: FXAA + light bloom only. No SSAO/SSR.
- LOD: 3 levels for buildings; far chunks as imposters.
- Characters: ~3k tri rigged student, palette swap; shared skeleton and clips (idle, walk, run, crouch, aim, shoot, reload, hit, death, drive).

## Camera & controls
Third-person over-the-shoulder; pointer lock; WASD, Shift sprint, Ctrl crouch, Space jump, LMB shoot, RMB aim, R reload, F interact/enter vehicle, **Tab quick menu**, M map. Local player is predicted; remote players interpolated (100 ms buffer).

## SQL pop-up (key feature)
Non-blocking right-side panel (~45% width, translucent); the world keeps rendering and the player stays vulnerable.
```
┌──────────────────────── World keeps running ───────────────────────────┐
│  HP ▮▮▮▮▯  Ammo 12   ◄ attacker direction indicator                    │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Vault 2/3 · Tier 3 · ⏱ 02:10         [Switch task ▾] [— minimise]  │ │
│ ├──────────────────────────┬─────────────────────────────────────────┤ │
│ │ Story / task             │ SELECT ...      (CodeMirror 6)          │ │
│ │ Schema (tables, columns) │                                         │ │
│ │ Sample rows              │ [Run ▶ free]  [Submit ✔]  [Hint −$]     │ │
│ │                          │ Result table / error / diff hint        │ │
│ └──────────────────────────┴─────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```
- Auto-crouch while open; Esc blurs editor so movement keys control the player.
- **Run** = preview ≤5 rows, free, rate-limited. **Submit** = graded. Wrong → lockout countdown (server value).
- **Switch task** (Heal / Gun / Vault): draft saved locally per question; new request → new variant.
- Damage feedback: red vignette + directional arrow + sound; minimise to a slim HP bar to fight.
- All text (story, hints, costs, lockout) comes from server payloads; the client hard-codes none.

## Testing
Unit (Vitest): codec, interpolation, prediction. UI: Playwright smoke for pop-up flow against a mock server. Perf: scripted fly-through logs fps/draw calls via `renderer.info` (Phase 8+).
