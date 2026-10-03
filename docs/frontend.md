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
- Hooks for the game: `onSolved({rewardKey, target})`, `onHintCharged(hint)`, `panel.onStateChange(...)`.

Measured size (gzipped, `npm run size`): client code ≈ 266 kB for the demo page (Three.js ≈ 128 kB, panel + CodeMirror ≈ 137 kB) against a 1 MB code budget; the check runs in CI.

## Testing
Unit (Vitest): codec, interpolation, prediction. UI: Playwright smoke for pop-up flow against a mock server. Perf: scripted fly-through logs fps/draw calls via `renderer.info` (Phase 8+).
