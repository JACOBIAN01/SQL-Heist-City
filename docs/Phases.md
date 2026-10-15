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
| 11 | Bank design | ✅ Done |
| 12 | Known gaps | ✅ |
| 13 | Identity and persistence (Google sign-in, PostgreSQL) | ✅ |
| 14 | Classroom mode | ✅ |
| 15 | Learning analytics (RCSBE and Bloom, live radars) | ✅ |
| 16 | Teaching loop | ✅ |
| 17 | Question types and content (filling R, C, B, E) | 🟨 17.1–17.13 done |
| 18 | Security hardening | ⬜ |
| 19 | Scale proof | ⬜ |
| 20 | Operations and deployment | ⬜ |
| 21 | Privacy and compliance | ⬜ |
| 22 | Settings, accessibility and devices | ⬜ |
| 23 | Game test plan | ⬜ |
| 24 | Classroom pilot | ⬜ |
| 25 | Launch checklist and release | ⬜ |
| 26 | Progression and the meta-loop | ⬜ |
| 27 | Squads and roles | ⬜ |
| 28 | Game modes | ⬜ |
| 29 | Living city | ⬜ |
| 30 | Exploration and freedom | ⬜ |
| 31 | Missions and heist structure | ⬜ |
| 32 | Story and characters | ⬜ |
| 33 | SQL in the world: queries as superpowers | ⬜ |
| 34 | Breakthrough features | ⬜ |
| 35 | Polish | ⬜ |
| 36 | GTA scorecard gate | ⬜ |

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
## Phase 11 — Bank design  ✅
The bank is the most important place in the game: realistic interiors and a realistic vault, built from the House Pack (Quaternius, CC0) plus procedural pieces the pack lacks. Bank 1 is finished first as a showcase and reviewed, then the kit rolls out to Banks 2–5. Art is derived from the layout, so it never changes play; furniture with a collider goes through the shared layout so the server and the route tests see it.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 11.1 | Interior kit pipeline (`tools/city/build-interior.mjs` → `client/public/interior/`) | ~40 pieces built and previewed in `kit.html?set=interior`; size budget checked | ✅ 64 pieces, 26k triangles, 415 KB, life size, one material with night-glowing lamps; `InteriorKit` loader (tools/city/README.md "Interior furniture") |
| 11.2 | Furniture in the bank layout (piece, storey, x, z, yaw, solid) | solid pieces compile to colliders; every bank route/anchor test still passes | ✅ `furniture` in `BankLayout`, `placeFurniture`, `furniture` colliders, clearance tests, client art from the same placements; a first waiting area in Bank 1 (backend.md "Furniture") |
| 11.3 | Interior shell & materials (Bank 1) | marble lobby, wood/carpet offices, steel vault, door frames, skirting, ceiling lights; no grey boxes | ✅ room finishes, wainscoted walls, stone outside, ceiling panels, self-lit interiors (frontend.md "Bank interiors") |
| 11.4 | The vault (Bank 1) | round steel door (bolts, hinge, wheel) swings open on the last lock; deposit-box walls, cash carts, keypad console, alarm light | ✅ plus break-in animation per lock (wheel, bolts, sparks, sounds) and the opening swing (frontend.md "Bank interiors") |
| 11.5 | Lobby & teller hall (Bank 1) | glass-screened teller counter, queue stanchions, waiting area, columns, chandeliers, security room | ✅ teller screens, queue posts, waiting corner, columns, lift doors, back-wall ledgers, security room (frontend.md "Bank interiors") |
| 11.6 | Offices & upper storeys (Bank 1) | desks, shelves, bookshelves, lamps, meeting room, plants | ✅ open-plan office on storey 1, executive boardroom and lounge on storey 2 (frontend.md "Bank interiors") |
| 11.7 | Bank exterior (Bank 1) | grand entrance: columns, steps, double doors, name sign, ATM | ✅ pilasters, cornice, lintel, name plaque, doorstep, open doors, lanterns, ATM; glows at night (frontend.md "Bank interiors") |
| 11.8 | Bank 1 review gate | screenshots + walk-through approved by the user | ✅ approved as is (docs/review/bank-1.md) |
| 11.9 | Roll out to Banks 2–5 | each bank dressed, with a look by tier (modest → marble and gold) | ✅ rooms, furniture, fixtures, facade and vault fittings for every bank; stone by tier (sandstone → white marble); desks and pillars are furniture, not blocks (docs/review/banks-2-5.md) |
| 11.10 | Interior performance | detail only near/inside a bank; draw-call and triangle budget test in CI; 60 fps kept | ✅ `BankLod`, merged meshes, `bankBudget.test.ts`: one bank ≤ 50 draw calls and 80k triangles anywhere (worst today 39 / 59k; before: 100–200 calls per bank) |

---
## Roadmap after Phase 11 (from the pre-launch audit)
Phases 12–36 come from the pre-launch audit and the user's feedback on it (October 2026). The decisions behind them:
- **The game is violent by design, and stays that way.** Guns, shooting and kills are the core of the match. There is no non-violent, stun or arrest mode, now or later, and no feature may soften combat (no no-damage zones, no pause while solving).
- **Class size is 60+ (usually 100+).** The map stays sized for 100 players.
- **Chat and voice are out of scope for now**, including quick-chat and pings.
- **Identity:** Google sign-in (OpenID Connect).
- **Persistence:** PostgreSQL is the system of record for accounts, classes, attempts and content. The SQL sandboxes stay in-memory SQLite.
- **Learning analytics:** each question carries one RCSBE tag (Recall, Comprehend, Solve, Build, Evaluate), one Bloom level and a weight in marks. Every student has live RCSBE and Bloom profiles, drawn as radar charts for students and teachers (docs/RCBSE.md).

Phases 12–25 are **pre-launch**: they make the game safe to put in front of real classes and prove that it teaches. Phases 26–36 are **post-launch**: they take each GTA-style pillar to at least 8/10 and build the breakthrough features. Each phase still ends with an approval gate.

---
## Phase 12 — Known gaps  ✅
Items left over from Phases 7–9 (audit con 19).

| # | Subphase | Done when | Status |
|---|---|---|---|
| 12.1 | Office loose cash: small cash piles on bank office desks, picked up by walking over them like a bag, laid out again each round, amounts in settings | piles spawn, can be carried and banked, and their amounts are admin-editable | ✅ a pile on every other desk (`cashOnDesks`), `looseCashByTier` $1k–$4k a pile, never holds a round open, drawn as banded notes and left off the minimap (gameplay.md "Loose office cash") |
| 12.2 | Full-screen map (M): the whole city, banks with lock progress, safehouses, hospital, bounties, your position | opens and closes without pausing the world; tested on every map | ✅ `FullMapView` (north up, bank names with locks, hospital, wanted, bags, you, a legend); mute moved from M to N; marker drawing shared with the minimap (frontend.md "Full-screen map") |
| 12.3 | Cars hurt people: run-over damage from speed and car mass, the kill credited to the driver, no damage below a speed floor | a test shows a fast car kills and a slow nudge does not; the numbers are settings | ✅ `RunOverRule` + `VehicleSettings.runOver` and a `mass` per kind; a full-speed sedan does 105, a nudge 0; the driver gets the kill (gameplay.md "Running people over") |
| 12.4 | Admin editing for the city, day/night, vehicle, heist and tutorial settings (cards on the Settings page) | each settings key is editable, validated and hot-reloaded into a running match | ✅ heist, vehicles, day/night and city cards (generic `SectionCard`); matches re-read them each round and send clients a `world` message; the city rides in the map id and applies to new matches (admin.md "Gameplay settings reach a running match") |
| 12.5 | Admin-editable reward icons (an `icon` field per reward plus a picker; the client map moves out of code) | changing an icon in the admin changes it in the game | ✅ `rewardIcons` settings (an id from the bundled library per reward, `vault` for all locks); an icon picker card; the client follows the `world` message (frontend.md "Reward icons") |

---
## Phase 13 — Identity and persistence (Google sign-in, PostgreSQL)  ✅
Fixes audit cons 1 and 3: who is playing, and records that last.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 13.1 | Decision record: Google OpenID Connect (authorization code with PKCE, server-side), PostgreSQL for persistence; options weighed and rejected | `docs/identity.md` written and approved | ✅ written (flow, tickets, options weighed, storage split); approval given by the owner's "go through all phases" |
| 13.2 | PostgreSQL in dev (compose), a migration tool, a test database for CI | `npm run db:migrate` builds an empty database; CI runs against it | ✅ `server/src/pg` (PgDatabase, advisory-locked append-only migrations), `scripts/pg-dev.mjs` private cluster, CI service container, PostgreSQL tests skip with a warning when none is reachable |
| 13.3 | Move admin content (questions, versions, settings, pools, audit, users) from the SQLite file to PostgreSQL behind the existing repositories | every repository contract test passes on both; a one-shot import from `dev.db` works | ✅ async stores for questions, users, sessions, audit, pools and settings with SQLite and PostgreSQL versions under shared contract tests; the whole admin runs on PostgreSQL (`DATABASE_URL`); the game reads a refreshed local snapshot; `npm run db:import-sqlite` |
| 13.4 | Players table and repository (Google subject id, email, display name, school domain, created and last seen) | contract tests pass; no other personal data stored | ✅ `players` + `player_sessions` (migration 2), `PlayerRepository` with in-memory and PostgreSQL versions under one contract suite |
| 13.5 | Google sign-in on the server: login, callback, ID-token check, optional allow-list of school domains, sessions | sign-in works end to end against a test Google project; a bad or expired token is refused | ✅ authorization code + PKCE + state + nonce, ID token verified with `jose`, school-domain allow-list, signed flow cookie, player session cookie; tested against a fake Google (real Google needs the OAuth client in docs/inputs-needed.md #1) |
| 13.6 | Signed, short-lived game tickets: the game socket admits only a valid ticket, and the name comes from the account, not the URL | `?name=` is gone; a socket without a ticket is refused | ✅ join carries a signed one-use ticket (protocol 5); the name comes from the account; required in production, optional in development; one account = one player per match |
| 13.7 | Client main menu and sign-in screen (sign in, profile, play, tutorial, settings) | a new player reaches a match only through the menu | ✅ `entry.ts` shows the menu on a bare address (sign in with Google, play, tutorial, change name, download data, delete account, sign out); any `?param` still goes straight to the game for developers; production requires a ticket so the menu is the only way in |
| 13.8 | Display names: rules plus a word filter (configurable lists), teacher rename | an offensive name is refused; teachers can rename a student | ✅ `checkDisplayName` (length, characters, look-alike-proof word filter, allowed exceptions); word lists editable in Settings; players rename in the menu, staff rename from `/api/players` (audited) |
| 13.9 | Local dev and test sign-in bypass (dev builds only, never in production) | bots, tests and `?at=` debugging keep working without Google | ✅ unsigned joins work unless the server requires tickets (always in production); `DEV_LOGIN=1` adds a made-up-player sign-in for testing the signed flow, refused in production |
| 13.10 | Account deletion and data export for a player | deleting an account removes or anonymises every row that refers to it | ✅ `PersonalDataRegistry`: each store of player data registers an exporter and an eraser (account, audit trail today; attempts, profiles and rosters join in later phases); export and delete are in the menu |

---
## Phase 14 — Classroom mode  ✅
Fixes audit con 2. A teacher sets up a class in the admin. Students enter the class code and land in the same city and match.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 14.1 | Class model: name, code, owner teacher, city seed, banks in play, round length, player cap (60–200), status | create, read, update and archive tested; codes are unique and hard to guess | ✅ `classes` tables (migration 3), `ClassRepository` (in-memory + PostgreSQL, one contract suite), 6-character codes from an unambiguous alphabet, regenerate-code |
| 14.2 | Admin: class editor; pick which banks are open | a closed bank's vault cannot be worked, and its marker says "closed" | ✅ Classes page + editor (banks, seed, round length, cap 60–200); closed banks refuse locks, drop their loose cash, do not hold the round open, and show CLOSED on the minimap, full map and task menu |
| 14.3 | Admin: class question release, by bank lock, heal, gun and ammo, choosing existing questions or creating new ones and mapping them to the class | a class only ever receives questions mapped to it | ✅ per-usage question release (vault, heal, gun, ammo) with a tick table; "write a new question" links to the editor |
| 14.4 | Wire pools into `QuestionSelector` (the backlog's "game side of pools"): selection respects the class's mapping and tiers, with no repeats | tests prove nothing outside the class set is issued | ✅ `QuestionSelector` takes an allowed set (tiers widen only inside it; empty set = nothing); a class match passes the set with every task |
| 14.5 | Join by code: the student signs in, types the code, waits in a lobby, and the match starts on the teacher's word | 100 headless clients join one class and land in the same match | ✅ the menu's Join class (code → roster → waiting room → room), class-bound tickets, `GET /class/:id`; an integration test puts 100 ticketed sockets in one worker-thread match and turns away the 101st |
| 14.6 | One match per class: `MatchPool` and the lobby route by class code; many classes run side by side | two classes at once never see each other's players or questions | ✅ `ClassRooms`: one worker-thread match per class, its own port, city seed, question set and cap; a class ticket opens only its own room; rooms are never offered to open play |
| 14.7 | Teacher live controls: start, end round, next round, lock the room, kick, rename | each control works from the admin during a match | ✅ Room card: start the match, end round, next round, stop, lock to new students; remove or rename a student; edits to a running class apply at once (`refresh`); all audited |
| 14.8 | Class roster: everyone who joined, linked to their account, with round history | the roster lists students and their rounds | ✅ roster (joined, rename, remove) linked to accounts; each student's per-round results are available from the class results store (`forPlayer`) and shown in the rounds table |
| 14.9 | Class results stored (rounds, scores, awards) | a finished round can be reviewed later from the admin | ✅ `class_rounds` + `class_results` (migration 4); the room reports each round's standings and awards to the game server, which records them; the editor lists rounds and opens a table |

---
## Phase 15 — Learning analytics (RCSBE and Bloom, live radars)  ✅
Fixes audit con 4. Every question carries one RCSBE tag, one Bloom level and a weight in marks. Every attempt is recorded. Each student's RCSBE and Bloom profiles update live and are drawn as radar charts for the student and the teacher. Design: docs/RCBSE.md.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 15.1 | RCSBE design: docs/RCBSE.md (lens, Bloom mapping, earned/available rules, pooling, live updates, radars) | the doc and its open questions (§11) are answered and approved | ✅ the proposed defaults adopted as settings (RCBSE.md §11); the owner can change any of them in Settings |
| 15.2 | Attempt events: issued, run, submit (right or wrong, error kind), hint, lockout, switch, expiry, death, with player, class, question, seed, timings and a snapshot of the item's RCSBE tag, Bloom level and marks | every attempt in a match lands in PostgreSQL; the write path costs < 0.5 ms per tick | ✅ `AttemptSink` events + one item record per issued question (tags, marks, timings, hints, outcome); batched off the tick; verified end to end through a real room thread and PostgreSQL |
| 15.3 | Question metadata: `rcsbe` (exactly one of R/C/S/B/E), `bloom`, `marks` (default by tier) in the schema, versions, editor, import/export; the validator refuses missing or multiple tags | a question cannot be saved without them | ✅ `rcsbe` (exactly one), `bloom`, `marks` in the schema, versions, editor, CSV and JSON; missing, doubled or unknown tags are refused; legacy rows read as Solve/Apply |
| 15.4 | Tag all 150 questions (RCSBE, Bloom, marks); coverage report per tier, RCSBE dimension and Bloom level | 100% tagged; the report shows today's gap (all S) | ✅ all 150 tagged (Solve; Apply 104, Analyze 46); `questions:validate` prints coverage by dimension and Bloom level and the gap to the target |
| 15.5 | Earned/available rules (docs/RCBSE.md §6): hint penalty, abandon threshold, death, tutorial excluded; every threshold a setting | unit tests cover each row of the rule table | ✅ `scoreItem` (solved, hints with a floor, worked failures, idle drops, death, tutorial), every threshold a setting |
| 15.6 | `ProfileAggregator`: subscribes to the heist event bus; additive totals per student, scope (round, class, all-time), lens (RCSBE, Bloom) and dimension; pooled marks, never averaged percentages; a rebuild job from raw attempts | live totals equal a full rebuild on replayed logs | ✅ `ProfileAggregator` (additive, pooled marks); a test replays 40 items through the live path and compares with a rebuild |
| 15.7 | Remediation signal: the lowest dimension with enough evidence (≥ 3 items, ≥ 5 marks; settings); thin dimensions report "not enough data" | tested on edge cases (no data, ties, one item) | ✅ `remediation`: lowest axis with ≥3 items and ≥5 marks; thin axes are "not enough data", never 0 |
| 15.8 | Live push: a `profile` message to the student after each graded item; a live channel per class for teachers | student radar moves < 1 s, teacher's < 2 s after a submit | ✅ `profile` message to the student after each counted question (in memory first, then stored); the teacher's pages refresh every 3 s from the stored totals |
| 15.9 | Radar chart module (SVG, no library): axes, values, evidence; thin axes dashed; colour-blind safe; DOM and React wrappers | geometry tests pass; renders in game and admin | ✅ shared `radarModel` (axes, rings, thin axes, comparison layers), a DOM drawer for the game and a React one for the admin, colour-blind-safe palette with dashes |
| 15.10 | Student radars in game: RCSBE and Bloom; round-end card (round over all-time), profile page with drill-down to topics, a pulse on the axis that moved | a student watches their radar change during a match | ✅ P opens the profile (RCSBE and Bloom radars, the numbers in words, the weakest axis), pulses the axes that moved; a round-end card shows this round over all time |
| 15.11 | Teacher radars in admin: student page (with class average and target overlays), class page (class profile and a live grid of mini radars sorted by weakest dimension) | a teacher watches a live class profile during a match | ✅ class Learning page (class radars over the target, weakest-first grid of mini radars) and a student page (over the class, round by round, topics) |
| 15.12 | Class target profile and paper QA: the class editor shows the question set's shape (share of marks per dimension) over the target, and flags gaps | a class with no Comprehend items is flagged before play | ✅ the Paper tab compares the class's released questions with the target and lists what is missing or off |
| 15.13 | Teacher dashboard beyond radars: spread per dimension, trends per round, per-question item analysis | each view renders real data from a played class | ✅ spread per dimension, trend per round, per-question item analysis |
| 15.14 | Question-quality analytics in the admin: solve rate, median time, wrong-answer rate, how well it separates strong and weak students within its dimension | each question page shows them; outliers flagged | ✅ solve rate, wrong-first rate, median time, separation (top third minus bottom third, leaving the question out of each student's strength) and flags |
| 15.15 | CSV export (class, student, question, profile), compatible with the dimension-analysis sheet format | export opens in a spreadsheet and matches the sheet's columns | 🟨 CSV per class (profiles and questions) with formula-safe cells; the dimension-analysis sheet's exact columns need a sample from the owner |
| 15.16 | Topic mastery per student (feeds difficulty scaling in 16.7) | unit-tested and stable on replayed logs | ✅ `topicMastery`/`weakestTopics` pool marks per topic (shown per student; feeds 16.7) |
| 15.17 | Retention and aggregation rules (raw events kept N days, totals kept) | a job prunes on schedule and is tested | ✅ `RetentionJob` daily: raw events after 180 days, items after 730 (settings; 0 = keep), totals kept |
| 15.18 | Privacy of profiles: students see only their own; teachers only their classes; never on leaderboards | access tests pass | ✅ a student's profile goes only to their own player; teachers see only their classes (others get 403/404); never on leaderboards |

---
## Phase 16 — Teaching loop  ✅
Fixes audit cons 5 and 6: the game teaches as well as tests, and weaker students are never locked out. Combat stays as it is: help comes through hints, review and difficulty, never through protection from being shot.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 16.1 | Concept cards: one short explainer per topic (all topics across tiers 1–5), admin-editable | every topic has a card; cards are editable and versioned | ✅ 57 cards (one per topic used by any question) in `content/concepts/cards.json`, seeded by `db:seed`; Concepts page in the admin; every edit is a new version; `questions:validate` fails on a topic with no card |
| 16.2 | Post-round review: every question you saw, your last query, the model answer (after the round only) and the concept card | the review shows for every player; nothing leaks during the round | ✅ `ReviewKeeper` keeps each player's questions in memory and sends a `review` (their last query, the model answer, concept cards) only when the round ends; V opens it in game |
| 16.3 | Escalating hints: a free nudge, then the concept card, then paid hints (costs in settings) | hint ladder tested; costs are settings | ✅ free nudge → free concept card → the question's paid hints (`freeHintSteps` setting); only paid steps count against the profile |
| 16.4 | Syntax-error explainer: SQLite errors turned into plain-language advice | the common errors (unknown column, missing GROUP BY, ambiguous column…) are explained | ✅ `adviceFor`: 17 SQLite errors in plain words, checked against the real engine's messages; shown as a Tip under the error |
| 16.5 | Editor autocomplete from the challenge schema (tables, columns, keywords) | autocomplete offers only this challenge's names | ✅ keywords plus this question's tables and columns (bare and `table.column`), replaced on every new question |
| 16.6 | Tables sidebar that stays open while fighting (minimised pop-up keeps the schema in view) | schema visible with the pop-up minimised | ✅ the minimised bar lists every table with its columns |
| 16.7 | Skill-scaled difficulty: each student's question tier follows their mastery, with rewards and times scaled, so every student can earn a gun and crack some lock | a beginner can complete each reward type; a test covers the scaling | ✅ from the live profile: below 50% one tier easier, more time, smaller heals; below 25% two tiers; never for the tutorial; settings |
| 16.8 | Spaced repetition: weak topics come back in later rounds and daily contracts | resurfacing schedule tested against replayed data | ✅ the student's weakest topics (from stored items, updated live) are drawn from with a set chance (35%); daily contracts come with 26.5 |
| 16.9 | Practice mode: a separate solo SQL drill outside matches (no combat, no clock); matches themselves are unchanged | a student can practise any topic alone | ✅ menu → Practice SQL: pick a topic and tier, answer questions one after another (`/ws/practice`); no match, no rewards; counts toward the profile |
| 16.10 | Pre/post assessment: a short test before and after a unit; the gain shown per RCSBE dimension and Bloom level | the teacher can run both and see the gain on the radars | ✅ the class editor sets a pre- and post-test from the class's questions (no hints, one go each, same questions for all); students take them from the waiting room; answers count in their own scope; the Learning page's Gain tab shows class radars and each student's change per dimension |

---
## Phase 17 — Question types and content (filling R, C, B and E)  ⬜
Today every question is Solve. This phase adds the question types that measure Recall, Comprehend, Build and Evaluate (docs/RCBSE.md §10). It also covers every Bloom level, the backlog's structural variants and dialect packs (audit con 20).

| # | Subphase | Done when | Status |
|---|---|---|---|
| 17.1 | Question-type framework: a question declares its type; the grader, pop-up, admin editor and validator handle each | adding a type needs no change outside its own module | ✅ seven kinds (write, fix, faster, write_db, choice, fill, brief): server handlers, sandbox plan/write modes, pop-up views, editor field, QA gate |
| 17.2 | **R** Quick recall: fill the missing keyword or clause; short multiple choice (fits ammo refills) | type built; 20 questions | ✅ 20 in kinds-recall.json (12 fill, 8 choice) |
| 17.3 | **C** Predict the output: given a query and tables, pick or build the result | type built; 15 questions | ✅ 15 in kinds-predict.json (fixed `list` tables, options shuffled per player) |
| 17.4 | **C** Explain the error: given a failing query and its error, pick the cause | type built; 10 questions | ✅ 10 in kinds-errors.json (the real sandbox error is shown) |
| 17.5 | **C** Read the plan: given `EXPLAIN QUERY PLAN`, say what is slow | type built; 10 questions | ✅ 10 in kinds-plans.json (the real `EXPLAIN QUERY PLAN` is shown) |
| 17.6 | **S** Fix the query: a broken query is given; the answer must produce the right result | type built; 10 questions | ✅ 10 in kinds-fix.json; QA fails a fix whose broken query already passes |
| 17.7 | **S** Make it faster: correct and under a cost (rows scanned or plan steps) | cost measured in the sandbox; 10 questions | ✅ 10 in kinds-faster.json; cost = `SCAN` steps in the plan; QA checks the reference is within it and the slow one is not |
| 17.8 | **S** Write to a scratch database (`CREATE`/`INSERT`/`UPDATE`), graded by the resulting state | the writable sandbox keeps the safety limits; 10 questions | ✅ 10 in kinds-write.json; INSERT/UPDATE/DELETE/CREATE only, then read-only checks |
| 17.9 | **E** Choose and defend: two or three working queries under a stated constraint; marks mostly in the structured reasons | type built; 15 questions | ✅ 15 in kinds-defend.json; 1 mark for the pick, 2 for the reason, pass at 60% |
| 17.10 | **B** Open brief: the student sets the goal and the done-condition, writes the queries and states how they know it worked; between rounds (heist planning) | briefs submitted from the game | ✅ `brief:plan` from the round-results card (signed-in players), 8 brief questions in kinds-briefs.json, stored in `brief_submissions`; `taskKinds` keeps briefs out of in-round tasks |
| 17.11 | Rubric review queue in the admin for Build (and free-text Evaluate): rubrics per brief, batch marking, marks flow into profiles | a teacher marks 30 briefs and profiles update | ✅ admin "Briefs to mark": per-criterion marks, Save and next, re-marks; marks go into the profile and are audited (a teacher marking 30 is covered by the same flow, tested on 2) |
| 17.12 | Structural variants: table and column renames, story-theme swaps (designed in questions.md) | one question renders under two themes with the same grading | ✅ `themes` on a question; 46 bank questions render as a casino too, same grading (QA runs 100 seeds across both) |
| 17.13 | Coverage: new content until every tier has every RCSBE dimension and every Bloom level | the coverage report shows no empty cell | ✅ 10 questions in kinds-coverage.json; the QA gate prints the tier grid and fails on an empty cell (none left: 268 questions) |
| 17.14 | Dialect packs: PostgreSQL and MySQL notes and per-dialect cheat-sheets; quirks flagged per question | a class can pick a dialect pack; the pop-up shows its notes | ⬜ |

---
## Phase 18 — Security hardening  ⬜
Audit con 9 plus the old "rate limits" and "anti-cheat" todo items.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 18.1 | Socket origin allow-list; lobby CORS limited to the game's own origins | requests from another origin are refused | ⬜ |
| 18.2 | Rate limits on every message and route (game, challenge, lobby, admin, auth), with tests | each limit has a test that exceeds it | ⬜ |
| 18.3 | Anti-cheat: line-of-sight checks on hits, a speed envelope, fire-rate audit, impossible-action logging | cheat tests fail as expected; anomalies are logged | ⬜ |
| 18.4 | SQL sandbox fuzzing (hostile and oversized queries, resource bombs) in CI | the fuzzer runs nightly with no escapes | ⬜ |
| 18.5 | Secrets management and a dependency audit in CI | no secret in the repo; audit failures block a merge | ⬜ |
| 18.6 | External penetration test and fixes | report received and every high or critical finding fixed | ⬜ |

---
## Phase 19 — Scale proof  ⬜
Audit con 10 plus the old "100 and 200 player load test" todo item.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 19.1 | 100- and 200-client socket load test on production-like cloud hardware | tick p99 < 15 ms at 100, numbers in performance.md | ⬜ |
| 19.2 | Grader stress: 100 simultaneous submits including heavy recursive queries | queue wait p95 recorded and within target | ⬜ |
| 19.3 | Per-player grader limits (one job in flight, cooldown) | a flooding client cannot starve others | ⬜ |
| 19.4 | Several classes per server: capacity per core | sizing table in deployment.md | ⬜ |
| 19.5 | Soak test (4 h) and reconnect chaos (drops, rejoin mid-heist) | no leak, no lost progress | ⬜ |

---
## Phase 20 — Operations and deployment  ⬜
Audit con 8 plus the old "logging, metrics, backups, containers, deploy" todo items.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 20.1 | Containers for the game server and admin; compose for local staging | `docker compose up` runs the full stack | ⬜ |
| 20.2 | Staging environment and a CI deploy to it | a merge to main deploys to staging | ⬜ |
| 20.3 | Managed PostgreSQL with nightly backups and a tested restore drill | restore drill documented and passed | ⬜ |
| 20.4 | Structured logs, metrics dashboards, alerts (tick, players, grader queue, errors) | dashboards live; alerts fire in a test | ⬜ |
| 20.5 | Client error reporting | a thrown error in the browser reaches the error log | ⬜ |
| 20.6 | CDN for the client, TLS and WSS, domain | the game loads over HTTPS from the CDN | ⬜ |
| 20.7 | Release and rollback procedure | a rollback is rehearsed on staging | ⬜ |

---
## Phase 21 — Privacy and compliance  ⬜
Required before student data flows: Google accounts, attempts and classes. The game stays violent, so it ships with a proper content rating and age gate rather than a softer mode.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 21.1 | Data map: every field stored, why and for how long | `docs/privacy.md` approved | ⬜ |
| 21.2 | Privacy policy and terms for schools and students (minors), reviewed for COPPA, GDPR and India's DPDP Act | published in the game and the admin | ⬜ |
| 21.3 | School consent flow (teacher or school admin accepts on the class's behalf) | a class cannot start without it | ⬜ |
| 21.4 | Retention and deletion jobs tied to 15.10 and 13.10 | tested | ⬜ |
| 21.5 | Log audit: no personal data in logs or metrics | a scan of the logs finds none | ⬜ |
| 21.6 | Data processing agreement template for schools | template ready | ⬜ |
| 21.7 | Content rating for a violent game (IARC, giving PEGI/ESRB ratings) and an age gate at sign-in; the violence is stated plainly to schools at class creation | rating obtained; under-age accounts refused; the notice shows in the class editor | ⬜ |

---
## Phase 22 — Settings, accessibility and devices  ⬜
Audit con 17.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 22.1 | In-game settings menu: sensitivity, invert, FOV, volume per channel, graphics quality | settings persist per account | ⬜ |
| 22.2 | Key remapping | every action remappable; conflicts flagged | ⬜ |
| 22.3 | Accessibility: text size, colour-blind palettes, reduced motion, subtitles for sound cues | a WCAG-style check of the HUD and pop-up passes | ⬜ |
| 22.4 | Gamepad support | full play with a controller | ⬜ |
| 22.5 | Touch controls (tablets and touch Chromebooks) | full play by touch | ⬜ |
| 22.6 | Real-device performance pass (3 low-end Chromebooks, integrated GPUs) | ≥ 60 fps target, 30 fps floor, numbers recorded | ⬜ |
| 22.7 | Localisation framework (UI strings out of code) and the first two languages | the UI switches language at runtime | ⬜ |

---
## Phase 23 — Game test plan  ⬜
Audit section "Pre-launch checklist" and the user's item 5.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 23.1 | Test strategy doc: levels, owners, entry/exit criteria, bug severity scale, triage process | `docs/testing.md` updated and approved | ⬜ |
| 23.2 | End-to-end browser tests: sign in, join class, solve, crack, carry, bank, round end, review | the suite runs in CI on every merge | ⬜ |
| 23.3 | Multiplayer integration tests with headless clients (class of 100, two classes at once) | runs nightly | ⬜ |
| 23.4 | Performance regression in CI (bundle, draw calls, triangles, tick) | a regression fails CI | ⬜ |
| 23.5 | Internal playtests (scripted sessions, observation notes, survey) | three sessions run, findings filed | ⬜ |
| 23.6 | Usability tests with students (think-aloud, first-time-user flow) | findings filed and triaged | ⬜ |
| 23.7 | Bug bash and triage until no critical or high bugs remain open | zero open critical or high | ⬜ |

---
## Phase 24 — Classroom pilot  ⬜
Proof that it is fun and that it teaches before launch.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 24.1 | Pilot plan: 2–3 schools, classes of 60+, pre/post test, survey, consent | plan approved | ⬜ |
| 24.2 | Run the pilot (several sessions per class) | sessions held; data collected | ⬜ |
| 24.3 | Pilot report: learning gain, fun, retention, bugs, teacher feedback | report in `docs/review/pilot.md` | ⬜ |
| 24.4 | Fix what the pilot found (critical and major) | each fix shipped and re-checked | ⬜ |

---
## Phase 25 — Launch checklist and release  ⬜
The release gate. Every line is verified, not assumed.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 25.1 | Release checklist document (identity, classroom, analytics, teaching loop, security, scale, ops, privacy, accessibility, tests, pilot) | the checklist is approved | ⬜ |
| 25.2 | Walk the checklist; every item evidenced (test, report or screenshot) | all items ticked with evidence | ⬜ |
| 25.3 | Production deploy | live | ⬜ |
| 25.4 | Launch monitoring for the first two weeks (dashboards, on-call, daily triage) | two clean weeks or issues fixed | ⬜ |
| 25.5 | First 30 days: tune tiers, times and rewards from real attempt data | a tuning report and settings changes | ⬜ |

---
## Phase 26 — Progression and the meta-loop  ⬜
Post-launch. Audit con 14 and "Rewards" and "Progression" in the GTA audit (target 8–9).

| # | Subphase | Done when | Status |
|---|---|---|---|
| 26.1 | XP and ranks from play and from learning (mastery counts more than kills) | XP rules in settings; ranks shown | ⬜ |
| 26.2 | Skill tree by SQL topic, driven by mastery | tree shows locked and unlocked topics per student | ⬜ |
| 26.3 | Cosmetics (masks, outfits, car paint) unlocked by mastery and rank, no loot boxes | unlocks work and show to others | ⬜ |
| 26.4 | In-round streak bonus for consecutive correct answers (in gameplay.md, never built) | bonus paid; settings-driven | ⬜ |
| 26.5 | Daily contracts (three short SQL jobs a day) and day streaks | contracts refresh daily; streak tracked | ⬜ |
| 26.6 | Weekly class leagues on mastery as well as cash | league table per class | ⬜ |
| 26.7 | Seasons: themed content, a free progression track | a season can be configured and run | ⬜ |
| 26.8 | Share cards: the round's best query, time, haul and award as an image | a card can be saved and shared | ⬜ |
| 26.9 | Player profile page (rank, mastery, history, cosmetics) | profile shows real data | ⬜ |

---
## Phase 27 — Squads and roles  ⬜
Post-launch. Audit con 13. No chat (out of scope).

| # | Subphase | Done when | Status |
|---|---|---|---|
| 27.1 | Squads of 3–4 inside a class; shared vault progress and shared banked cash | squads score as one | ⬜ |
| 27.2 | Squad forming: teacher picks, self-pick, or auto-balance by mastery | all three ways work | ⬜ |
| 27.3 | Roles (hacker, driver, enforcer, lookout) with small perks, tuned in settings | each role's perk works and is balanced in a playtest | ⬜ |
| 27.4 | Squad HUD: teammates on the minimap, their task and health | visible in play | ⬜ |
| 27.5 | Squad awards and squad leaderboard | shown at round end | ⬜ |

---
## Phase 28 — Game modes  ⬜
Post-launch. Audit con 16.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 28.1 | Mode framework: a class picks a mode; rules as settings | modes switch without code changes | ⬜ |
| 28.2 | Smash and Grab: a 5-minute round, one bank | playable end to end | ⬜ |
| 28.3 | SQL Quick Draw: 1v1 duel, the same question, the first correct answer wins the shot | playable end to end | ⬜ |
| 28.4 | Classic heist (today's mode), with teacher-picked length | unchanged behaviour under the framework | ⬜ |

---
## Phase 29 — Living city (world immersion)  ⬜
Post-launch. GTA audit "World immersion" from 5 to 8–9.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 29.1 | Pedestrians: a cheap crowd (instanced, LOD), react to gunfire and flee | crowd at budget; reacts to shots | ⬜ |
| 29.2 | Traffic on the lanes, obeying junctions, reacting to crashes | traffic flows; server-owned and cheap | ⬜ |
| 29.3 | Bank guards (PvE) that patrol and respond to alarms | guards fight back; numbers in settings | ⬜ |
| 29.4 | Police response: wanted level from alarms and kills, chases, roadblocks | escaping the police is a real challenge | ⬜ |
| 29.5 | Weather (rain, fog) and richer ambient sound | weather cycles; budgets kept | ⬜ |
| 29.6 | Shops and vendors: spend cash on armour, ammo and cosmetics | buying works and is server-checked | ⬜ |
| 29.7 | Car radio | stations play in cars | ⬜ |
| 29.8 | Immersion review: re-score World immersion | scored ≥ 8 in a review with screenshots | ⬜ |

---
## Phase 30 — Exploration and freedom  ⬜
Post-launch. GTA audit "Exploration" (3) and "Freedom" (5) to 8–9.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 30.1 | Districts with their own look and landmarks | each district recognisable on sight and on the map | ⬜ |
| 30.2 | Points of interest and hidden caches (found through SQL intel, see Phase 33) | caches spawn and pay out | ⬜ |
| 30.3 | Collectibles tied to SQL trivia | collectibles tracked per player | ⬜ |
| 30.4 | Safehouse properties and upgrades bought with banked cash | upgrades persist and matter | ⬜ |
| 30.5 | Map discovery (fog over unexplored districts) on the full-screen map | discovery persists per player | ⬜ |
| 30.6 | Side activities: street races, deliveries, each with an SQL twist | two side activities playable | ⬜ |
| 30.7 | Approach choice in heists: stealth versus loud, each with its own payoff | both approaches can win | ⬜ |
| 30.8 | Review: re-score Exploration and Freedom | both ≥ 8 | ⬜ |

---
## Phase 31 — Missions and heist structure  ⬜
Post-launch. GTA audit "Missions" from 3 to 8–9.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 31.1 | Three-act heists: setup (intel jobs), the heist, the getaway | a full three-act heist plays end to end | ⬜ |
| 31.2 | Contract board with varied jobs (intel, sabotage, data theft, escort) | at least four contract types | ⬜ |
| 31.3 | Getaway: police roadblocks placed by what your intel queries revealed | intel changes the getaway | ⬜ |
| 31.4 | Payout screen: the take split, bonuses, mastery gained | shown after every heist | ⬜ |
| 31.5 | Review: re-score Missions | ≥ 8 | ⬜ |

---
## Phase 32 — Story and characters  ⬜
Post-launch. GTA audit "Story" from 1 to 8–9.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 32.1 | Story bible: the city, the crew, a fixer per bank, the arc across tiers | approved | ⬜ |
| 32.2 | Story missions (solo or co-op), one chain per bank | five chains playable | ⬜ |
| 32.3 | In-engine cut-scenes and character barks (text) | scenes play and can be skipped | ⬜ |
| 32.4 | Question stories rewritten to follow the arc | stories match the chain they appear in | ⬜ |
| 32.5 | Review: re-score Story | ≥ 8 | ⬜ |

---
## Phase 33 — SQL in the world: queries as superpowers  ⬜
Post-launch. Breakthrough feature 1 and GTA audit "SQL fit" from 4 to 8–9.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 33.1 | City database: live tables mirroring the world (guards, cameras, cash drops, wanted players, police) | tables update from the match state, cheaply | ⬜ |
| 33.2 | Intel queries: a correct query shows its rows on the minimap for a while | intel appears and expires | ⬜ |
| 33.3 | Better queries give better intel (filters, joins, freshness) | quality scales the reward | ⬜ |
| 33.4 | Camera hacking and door control through queries | both usable in a heist | ⬜ |
| 33.5 | Anti-abuse: cooldowns, ranges, fairness tests | balance playtest passes | ⬜ |
| 33.6 | Review: re-score SQL fit | ≥ 8 | ⬜ |

---
## Phase 34 — Breakthrough features  ⬜
Post-launch. Audit section "Breakthrough features" 2–8.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 34.1 | Cops and robbers: police team queries logs to track the robbers | playable mode | ⬜ |
| 34.2 | Co-op split queries: a tier-5 vault needs a three-part CTE, one part per squad member | parts join and grade together | ⬜ |
| 34.3 | Fix the inside man's query mid-heist (uses 17.1) | appears in heists | ⬜ |
| 34.4 | Optimisation leaderboards (rows scanned, query length) | per class and global | ⬜ |
| 34.5 | Teacher heist builder: a story plus a question chain makes a custom heist; shareable | a teacher builds and shares one | ⬜ |
| 34.6 | Async ghost heists: replay a top player's heist as a ghost to beat | ghost replays work | ⬜ |
| 34.7 | Localised stories, bank names and currencies per country (uses 22.7) | two countries' themes ship | ⬜ |

---
## Phase 35 — Polish  ⬜
Post-launch. Minor items from the audit.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 35.1 | Kill-cam showing the killer's view and how long their last query took | plays on death | ⬜ |
| 35.2 | Round replay (server-recorded) for teachers | a round can be replayed | ⬜ |
| 35.3 | Small UX fixes from pilot and launch feedback | backlog emptied | ⬜ |

---
## Phase 36 — GTA scorecard gate  ⬜
Post-launch. A review proving every pillar is at least 8/10.

| # | Subphase | Done when | Status |
|---|---|---|---|
| 36.1 | Re-score all eight pillars (immersion, exploration, missions, story, progression, freedom, rewards, SQL fit) with playtest evidence | every pillar ≥ 8 | ⬜ |
| 36.2 | Fix any pillar under 8 | re-scored ≥ 8 | ⬜ |
