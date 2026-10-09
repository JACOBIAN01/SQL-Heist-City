# Phases

## How to read this
- A **Phase** is a big milestone. It ends with a **user approval gate**: stop, summarise, wait.
- A **Subphase** (e.g. `1.3`) does **exactly one clear thing**, has a one-line **Done when**, and lands as **one or more small commits**.
- Status lives here and is updated in the same commit that finishes the work.

### Status legend
| Mark | Meaning |
|---|---|
| ⬜ Not started | |
| 🟦 In progress | being worked on now |
| 🟨 In review | built, waiting for user approval |
| ✅ Done | approved |
| ⛔ Blocked | waiting on a decision |

### Progress board
| Phase | Name | Status |
|---|---|---|
| 0 | Docs & scaffold | ✅ Done |
| 1 | Question engine | ✅ Done |
| 2 | Admin backend + UI | ✅ Done |
| 3 | Seed content (150 questions) | ✅ Done |
| 4 | SQL pop-up UI | ✅ Done |
| 5 | Walk & shoot sandbox | ✅ Done |
| 6 | Scale core (60/100/200) | ✅ Done |
| 7 | Heist loop v1 | ✅ Done |
| 8 | City, vehicles, atmosphere | ✅ Done |
| 9 | Banks 2–5, weapons, UX | ✅ Done |
| 10 | Polish: sound, SQL pop-up, tutorial | ✅ Done |
| 11 | Bank design | 🟦 In progress |
| — | Todo (later): harden & ship | ⬜ |

---
## Phase 0 — Docs & scaffold  ✅
Goal: agreed design + an empty monorepo that builds and tests.

| # | Subphase (one thing) | Done when | Status |
|---|---|---|---|
| 0.1 | Write all design docs | docs reviewed by user | ✅ Done |
| 0.2 | Create npm-workspaces monorepo (`client server admin shared`) | `npm install` works | ✅ Done |
| 0.3 | TypeScript base config shared by all workspaces | `npm run typecheck` passes | ✅ Done |
| 0.4 | Lint + format (ESLint, Prettier, editorconfig) | `npm run lint` passes | ✅ Done |
| 0.5 | Test runner (Vitest) with one sample test per workspace | `npm test` passes | ✅ Done |
| 0.6 | Hello-world server (`/health`) | curl returns ok | ✅ Done |
| 0.7 | Hello-world admin (Express `/health` + React page) | page loads | ✅ Done |
| 0.8 | Hello-world client (Vite + blank Three.js scene) | cube renders | ✅ Done |
| 0.9 | CI workflow (lint, typecheck, test) | pipeline file runs locally | ✅ Done |

---
## Phase 1 — Question engine (server only, no UI)  ✅
Goal: store, vary, and safely grade SQL questions.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 1.1 | Shared types + zod schemas for a question template | schema validates the sample in questions.md | ✅ Done |
| 1.2 | SQLite schema + migrations (questions, versions, hints, reward_map, settings) | migrations run on empty DB | ✅ Done |
| 1.3 | `QuestionRepository` (read/write interfaces + SQLite impl + in-memory fake) | CRUD tests pass | ✅ Done |
| 1.4 | Seeded `Rng` | same seed → same sequence | ✅ Done |
| 1.5 | Param resolver (`pick`, `int`, `date`, `bool`) | params deterministic per seed | ✅ Done |
| 1.6 | `DataGenerator` factory (serial, pick, int, fk, …) | generated tables deterministic per seed | ✅ Done |
| 1.7 | `VariantBuilder` (story + schema + data + reference SQL from a seed) | two seeds → two different variants | ✅ Done |
| 1.8 | SQL sandbox (in-memory SQLite, authorizer, SELECT-only) | dangerous SQL blocked | ✅ Done |
| 1.9 | Sandbox limits (timeout, row cap, worker thread) | infinite recursive CTE is killed | ✅ Done |
| 1.10 | `ResultComparator` (ordered/unordered, aliases, tolerance) | equivalent queries match | ✅ Done |
| 1.11 | `FeedbackBuilder` (non-leaky hints) | hints never contain reference SQL | ✅ Done |
| 1.12 | `Grader` (ties sandbox + comparator) | right answer ✔, wrong ✘ | ✅ Done |
| 1.13 | `QuestionSelector` (per reward, no repeats per player) | no repeat until pool exhausted | ✅ Done |
| 1.14 | `ChallengeService` facade (issue / run / submit, lockout) | full flow test passes | ✅ Done |

---
## Phase 2 — Admin backend + UI (Express + React)  ✅
Goal: teachers configure everything about questions.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 2.1 | Admin server skeleton (Express, error handling, zod validation middleware) | `/health` + validation test | ✅ Done |
| 2.2 | Users + login/logout (scrypt, session cookie) | login test passes | ✅ Done |
| 2.3 | Role guard (admin / teacher) | forbidden routes return 403 | ✅ Done |
| 2.4 | Question CRUD API | create/read/update/disable works | ✅ Done |
| 2.5 | Versioning + rollback | edit then rollback restores old | ✅ Done |
| 2.6 | Audit log | each change recorded | ✅ Done |
| 2.7 | Preview/test endpoint (reference × N seeds, try student query) | returns per-seed results | ✅ Done |
| 2.8 | Save-time validation (reference must pass ≥5 seeds) | bad question rejected | ✅ Done |
| 2.9 | Import/export (JSON, CSV, dry-run) | round-trip is lossless | ✅ Done |
| 2.10 | Settings + reward-map API | values persist and validate | ✅ Done |
| 2.11 | Pools API | pool CRUD works | ✅ Done |
| 2.12 | Hot-reload signal to game server | game picks up edit without restart | ✅ Done |
| 2.13 | React shell (routing, login page, layout) | can log in from UI | ✅ Done |
| 2.14 | UI: question list (filter, enable/disable) | list matches API | ✅ Done |
| 2.15 | UI: question editor (CodeMirror fields) | create/edit from UI | ✅ Done |
| 2.16 | UI: preview panel | shows variants/results | ✅ Done |
| 2.17 | UI: import/export | upload and download works | ✅ Done |
| 2.18 | UI: settings + reward-map editor | changes reach the game | ✅ Done |
| 2.19 | UI: pools, versions/diff, audit, users (analytics deferred — needs game attempt data) | each page renders real data | ✅ Done |

---
## Phase 3 — Seed content: 150 questions  ✅
Goal: ship 150 curated, editable questions.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 3.1 | `questions:validate` script (reference × 100 seeds, uniqueness, runtime) | runs on sample set | ✅ Done |
| 3.2 | Shared datasets (names, branches, items) for generators | referenced by questions | ✅ Done |
| 3.3 | Tier 1 — 30 questions | validator green | ✅ Done |
| 3.4 | Tier 2 — 30 questions | validator green | ✅ Done |
| 3.5 | Tier 3 — 30 questions | validator green | ✅ Done |
| 3.6 | Tier 4 — 30 questions | validator green | ✅ Done |
| 3.7 | Tier 5 — 30 questions | validator green | ✅ Done |
| 3.8 | `db:seed` (first admin + import via admin path) | fresh DB has 150 questions | ✅ Done |
| 3.9 | User spot-check in admin UI | user approves content | ✅ Done |

---
## Phase 4 — SQL pop-up UI  ✅
Goal: LeetCode-style, non-blocking panel, demo against real server.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 4.1 | Panel shell (layout, open/minimise, translucent overlay) | opens over a dummy canvas | ✅ Done |
| 4.2 | Problem pane (story, schema, sample rows) | renders a server payload | ✅ Done |
| 4.3 | CodeMirror SQL editor | typing + highlighting works | ✅ Done |
| 4.4 | Run (free preview) wired to server | preview rows shown | ✅ Done |
| 4.5 | Submit wired + result/feedback display | ✔/✘ shown | ✅ Done |
| 4.6 | Lockout countdown + hint button | lockout enforced from server value | ✅ Done |
| 4.7 | Task switcher (Heal / Gun / Vault) + draft saving | switch keeps drafts | ✅ Done |
| 4.8 | Timer + expiry handling | expired challenge closes cleanly | ✅ Done |
| 4.9 | Polish: responsive, keyboard shortcuts, bundle-size check | within budget | ✅ Done |

---
## Phase 5 — Walk & shoot sandbox  ✅
Goal: movement and combat feel good with 2+ real players.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 5.1 | Test map + lighting | scene renders at 60 fps (11 draw calls, ~600 tris) | ✅ Done |
| 5.2 | Local movement (walk, run, jump, crouch) | feels responsive | ✅ Done |
| 5.3 | Third-person camera + pointer lock | smooth orbit/aim | ✅ Done |
| 5.4 | Character model + animations | idle/walk/run play | ✅ Done |
| 5.5 | Binary protocol codec (`shared/`) | encode/decode tests pass | ✅ Done |
| 5.6 | Server tick loop + join/leave | two clients connect | ✅ Done |
| 5.7 | Server-side movement + collisions | no wall-walking | ✅ Done |
| 5.8 | Client prediction + reconciliation | no rubber-band at 100 ms | ✅ Done |
| 5.9 | Remote player interpolation | smooth other players | ✅ Done |
| 5.10 | Weapon fire (hitscan) + hit validation | hits registered by server | ✅ Done |
| 5.11 | Lag compensation | hits land at 100 ms latency | ✅ Done |
| 5.12 | Health, death, respawn | full kill cycle works | ✅ Done |

---
## Phase 6 — Scale core (60 → 100 → 200)  ✅
| # | Subphase | Done when | Status |
|---|---|---|---|
| 6.1 | Bot harness (`load:bots`) | spawns N scripted players | ✅ Done |
| 6.2 | Metrics (tick ms, bytes/s) + `/metrics` | visible numbers | ✅ Done |
| 6.3 | Baseline measurement (no optimisation) | numbers recorded in docs | ✅ Done |
| 6.4 | Spatial hash grid for players **and static colliders** (cell = 64 m chunk for AOI, 8 m for colliders; see city-kit.md §5) | neighbour and box queries tested; stepBody/rays only test nearby boxes | ✅ Done |
| 6.5 | AOI snapshots with tiered rates | bandwidth drops | ✅ Done |
| 6.6 | Delta compression + quantisation (int16 × 2 cm positions, world ≤ ±650 m) | <4 KB/s/client | ✅ Done |
| 6.7 | Object pools (no per-tick allocation) | GC pauses gone | ✅ Done |
| 6.8 | Match worker threads | one match per thread | ✅ Done |
| 6.9 | Tuning + 60/100/200 report | 100 bots under 15 ms tick | ✅ Done |

---
## Phase 7 — Heist loop v1 (one bank)  ✅
| # | Subphase | Done when | Status |
|---|---|---|---|
| 7.1 | Bank layout format + Bank 1 shell and lobby (logical walls → colliders; art from kit pieces, see city-kit.md) | walk inside | ✅ |
| 7.2 | Floors and stairs (the elevator is a teleport interaction, so it moves to 7.3) | reach every floor | ✅ |
| 7.3 | Interaction system (press F near object) + elevator | prompts + server validation | ✅ |
| 7.4 | Vault + lock state (persistent) | locks tracked server-side | ✅ |
| 7.5 | Vault lock ⇄ SQL challenge wiring | solve → lock opens | ✅ |
| 7.6 | Loot bags + carry/drop | drop on death works | ✅ |
| 7.7 | Safehouses + banking | cash banked, score updates | ✅ |
| 7.8 | Heal via SQL (3 tiers) | HP rises per tier | ✅ |
| 7.9 | Gun unlock via SQL + ammo refill | weapon granted | ✅ |
| 7.10 | Quick menu (Tab) + HUD | switch tasks mid-fight | ✅ |
| 7.11 | Death/respawn at hospital + spawn protection | rules from gameplay.md | ✅ |
| 7.12 | Scoreboard + round timer + win condition | round ends with winner | ✅ |

---
## Phase 8 — City, vehicles, atmosphere  ✅
Built from the Quaternius Downtown City MegaKit (CC0). Design: `city-kit.md`.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 8.1 | Kit build pipeline (`tools/city/`): ~60 light pieces, ≤ 6 atlas texture sets, WebP ≤ 3 MB, `kit.glb` + `kit.json` | one file loads; size report in docs | ✅ 66 pieces, 1 texture array + decals, 1.06 MB (city-kit.md §6) |
| 8.2 | Seeded `CityLayout` in `shared/` (roads, 64 m blocks, lots, bank/safehouse sites) → `GameMap` colliders | same seed = same city on server and client | ✅ `MATCH_MAP=city[:seed]`, client follows the server's map (backend.md "The city") |
| 8.3 | Facade grammar → kit placements, merged per chunk per material, fake-interior windows | a block renders with the kit | ✅ 25 chunks, ≤ 2 draw calls each (frontend.md "City art") |
| 8.4 | Chunk streaming + LOD (box impostors far, character LOD) | smooth traversal, draw calls < 200 | ✅ city ≈ 60 calls; detail built a chunk per frame (frontend.md "Streaming") |
| 8.5 | Day/night + fog + sky | cycle works | ✅ a 30-minute day from the match clock; lit windows at night (frontend.md "Day and night") |
| 8.6 | Post-FX (FXAA + bloom) | fps budget kept | ✅ steps down automatically when frames stay over 18 ms (frontend.md "Post-processing") |
| 8.7 | Vehicle physics (sedan; car models hand-downloaded or procedural) | drive and collide | ✅ Quaternius Cars pack; shared `stepVehicle`; `?drive` test drive (gameplay.md "Vehicles") |
| 8.8 | Vehicle enter/exit + networking | other players see it | ✅ server-owned cars, F in/out, protocol 4 vehicle records, predicted driving (gameplay.md "Vehicles") |
| 8.9 | Sports car + bike | all 3 drivable | ✅ sedan, sports, SUV drivable; bike dropped by decision (no model in the pack) |
| 8.10 | Spatial audio | footsteps, shots, ambience | ✅ every sound made in code as a stand-in (0 KB), 3D via Web Audio (frontend.md "Audio") |
| 8.11 | Perf pass | 60 fps, <8 MB load | ✅ 2.9 MB load (CI-enforced), ~250k tris / 55 calls in the city, 100 players 1.4 ms a tick (frontend.md "Perf pass"); fps on a real integrated GPU still to confirm by hand |

---
## Phase 9 — Banks 2–5, weapons, UX  ✅
| # | Subphase | Done when | Status |
|---|---|---|---|
| 9.1 | Bank 2 (new layout, same kit pieces and grammar) | playable | ✅ "City Trust", 4 storeys, on the tier-2 city site (backend.md "Bank layouts") |
| 9.2 | Bank 3 | playable | ✅ "Metro Capital", 4 storeys, door and vault off-centre (backend.md "Bank layouts") |
| 9.3 | Bank 4 | playable | ✅ "Grand Reserve", 5 storeys, two stair cores (backend.md "Bank layouts") |
| 9.4 | Bank 5 | playable | ✅ "Federal Vault", 6 storeys, split climb, vault behind an anteroom (backend.md "Bank layouts") |
| 9.5 | Remaining weapon tiers (SMG, shotgun, rifle, sniper) | stats from config | ✅ falloff, move spread, aiming/zoom/scope, recoil; admin Guns editor; server sends the numbers (gameplay.md "Combat") |
| 9.6 | Minimap + vault-progress markers | markers update live | ✅ rotating minimap, bank progress rings + alarm pulse, safehouses, bags (frontend.md "Minimap") |
| 9.7 | Killfeed + alarm/bounty events | events visible | ✅ alarm / vault open / banked / bounty lines in the feed; wanted players on the minimap; bounty reward (gameplay.md "Alarms, bounties and the feed") |
| 9.8 | Tutorial level | new player completes it | ✅ private room per player at `?tutorial`, 7 steps judged by the server, guide card + beacon; a scripted player completes it in tests (gameplay.md "Tutorial") |
| 9.9 | Round-end awards screen | awards shown | ✅ six awards tallied from heist events, shown as cards above the final standings (gameplay.md "Round awards") |

---
## Phase 10 — Polish: sound, SQL pop-up, tutorial  ✅
Quick fixes that improve play right away, before the bank work.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 10.1 | Quieter wind | default ambience lower everywhere; the sound board still plays it | ✅ 0.18 → 0.08 (`ambienceVolume`) |
| 10.2 | Expected output in the SQL pop-up: output columns + a worked example on separate example data (never the real answer) | every challenge shows it; the QA gate passes for all 150 questions | ✅ `ExampleBuilder`; pop-up, admin preview and QA gate show/check it (questions.md "Worked example") |
| 10.3 | Tutorial: one fixed question per task (heal, gun, vault), same for everyone every run, solution free | every tutorial run asks the same 3 questions; "Show solution" fills the editor at no cost | ✅ fixed slug + seed per task, `solution` only in tutorial rooms, free hints; admin "Tutorial questions" card (gameplay.md "Tutorial") |

---
## Phase 11 — Bank design  🟦
The bank is the most important place in the game: realistic interiors and a realistic vault, built from the House Pack (Quaternius, CC0) plus procedural pieces the pack lacks. Bank 1 is finished first as a showcase and reviewed, then the kit rolls out to Banks 2–5. Art is derived from the layout, so it never changes play; furniture with a collider goes through the shared layout so the server and the route tests see it.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 11.1 | Interior kit pipeline (`tools/city/build-interior.mjs` → `client/public/interior/`) | ~40 pieces built and previewed in `kit.html?set=interior`; size budget checked | ✅ 64 pieces, 26k triangles, 415 KB, life size, one material with night-glowing lamps; `InteriorKit` loader (tools/city/README.md "Interior furniture") |
| 11.2 | Furniture in the bank layout (piece, storey, x, z, yaw, solid) | solid pieces compile to colliders; every bank route/anchor test still passes | ✅ `furniture` in `BankLayout`, `placeFurniture`, `furniture` colliders, clearance tests, client art from the same placements; a first waiting area in Bank 1 (backend.md "Furniture") |
| 11.3 | Interior shell & materials (Bank 1) | marble lobby, wood/carpet offices, steel vault, door frames, skirting, ceiling lights; no grey boxes | ✅ room finishes, wainscoted walls, stone outside, ceiling panels, self-lit interiors (frontend.md "Bank interiors") |
| 11.4 | The vault (Bank 1) | round steel door (bolts, hinge, wheel) swings open on the last lock; deposit-box walls, cash carts, keypad console, alarm light | ✅ plus break-in animation per lock (wheel, bolts, sparks, sounds) and the opening swing (frontend.md "Bank interiors") |
| 11.5 | Lobby & teller hall (Bank 1) | glass-screened teller counter, queue stanchions, waiting area, columns, chandeliers, security room | ✅ teller screens, queue posts, waiting corner, columns, lift doors, back-wall ledgers, security room (frontend.md "Bank interiors") |
| 11.6 | Offices & upper storeys (Bank 1) | desks, shelves, bookshelves, lamps, meeting room, plants | ⬜ |
| 11.7 | Bank exterior (Bank 1) | grand entrance: columns, steps, double doors, name sign, ATM | ⬜ |
| 11.8 | Bank 1 review gate | screenshots + walk-through approved by the user | ⬜ |
| 11.9 | Roll out to Banks 2–5 | each bank dressed, with a look by tier (modest → marble and gold) | ⬜ |
| 11.10 | Interior performance | detail only near/inside a bank; draw-call and triangle budget test in CI; 60 fps kept | ⬜ |

---
## Todo (later) — Harden & ship  ⬜
Moved behind Phases 10–11. Not numbered until it is scheduled.

| Item | Done when | Status |
|---|---|---|
| Rate limits on every message/route | limits tested | ⬜ |
| Anti-cheat validation (speed, fire rate, LOS) | cheat tests fail | ⬜ |
| 100 and 200 player load test | report in docs | ⬜ |
| Logging, metrics dashboards, backups | documented + working | ⬜ |
| Containers + deploy scripts | staging deploy works | ⬜ |
| Production deploy + release checklist | live | ⬜ |
| Known gaps: office loose cash, full-screen map, cars hurting people, admin edits for city/day/vehicle/heist/tutorial settings | each built or dropped | ⬜ |
