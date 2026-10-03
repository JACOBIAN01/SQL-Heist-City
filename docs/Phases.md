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
| 5 | Walk & shoot sandbox | 🟨 In review |
| 6 | Scale core (60/100/200) | ⬜ |
| 7 | Heist loop v1 | ⬜ |
| 8 | City, vehicles, atmosphere | ⬜ |
| 9 | Banks 2–5, weapons, UX | ⬜ |
| 10 | Harden & ship | ⬜ |

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
## Phase 5 — Walk & shoot sandbox  🟨
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
## Phase 6 — Scale core (60 → 100 → 200)  ⬜
| # | Subphase | Done when | Status |
|---|---|---|---|
| 6.1 | Bot harness (`load:bots`) | spawns N scripted players | ⬜ |
| 6.2 | Metrics (tick ms, bytes/s) + `/metrics` | visible numbers | ⬜ |
| 6.3 | Baseline measurement (no optimisation) | numbers recorded in docs | ⬜ |
| 6.4 | Spatial hash grid | neighbour queries tested | ⬜ |
| 6.5 | AOI snapshots with tiered rates | bandwidth drops | ⬜ |
| 6.6 | Delta compression + quantisation | <4 KB/s/client | ⬜ |
| 6.7 | Object pools (no per-tick allocation) | GC pauses gone | ⬜ |
| 6.8 | Match worker threads | one match per thread | ⬜ |
| 6.9 | Tuning + 60/100/200 report | 100 bots under 15 ms tick | ⬜ |

---
## Phase 7 — Heist loop v1 (one bank)  ⬜
| # | Subphase | Done when | Status |
|---|---|---|---|
| 7.1 | Bank 1 exterior + lobby | walk inside | ⬜ |
| 7.2 | Floors, stairs, elevator | reach every floor | ⬜ |
| 7.3 | Interaction system (press F near object) | prompts + server validation | ⬜ |
| 7.4 | Vault + lock state (persistent) | locks tracked server-side | ⬜ |
| 7.5 | Vault lock ⇄ SQL challenge wiring | solve → lock opens | ⬜ |
| 7.6 | Loot bags + carry/drop | drop on death works | ⬜ |
| 7.7 | Safehouses + banking | cash banked, score updates | ⬜ |
| 7.8 | Heal via SQL (3 tiers) | HP rises per tier | ⬜ |
| 7.9 | Gun unlock via SQL + ammo refill | weapon granted | ⬜ |
| 7.10 | Quick menu (Tab) + HUD | switch tasks mid-fight | ⬜ |
| 7.11 | Death/respawn at hospital + spawn protection | rules from gameplay.md | ⬜ |
| 7.12 | Scoreboard + round timer + win condition | round ends with winner | ⬜ |

---
## Phase 8 — City, vehicles, atmosphere  ⬜
| # | Subphase | Done when | Status |
|---|---|---|---|
| 8.1 | Seeded city layout (roads, blocks) | same seed = same city | ⬜ |
| 8.2 | Instanced buildings + props | draw calls <200 | ⬜ |
| 8.3 | Chunk streaming + LOD | smooth traversal | ⬜ |
| 8.4 | Day/night + fog + sky | cycle works | ⬜ |
| 8.5 | Post-FX (FXAA + bloom) | fps budget kept | ⬜ |
| 8.6 | Vehicle physics (sedan) | drive and collide | ⬜ |
| 8.7 | Vehicle enter/exit + networking | other players see it | ⬜ |
| 8.8 | Sports car + bike | all 3 drivable | ⬜ |
| 8.9 | Spatial audio | footsteps, shots, ambience | ⬜ |
| 8.10 | Perf pass | 60 fps, <8 MB load | ⬜ |

---
## Phase 9 — Banks 2–5, weapons, UX  ⬜
| # | Subphase | Done when | Status |
|---|---|---|---|
| 9.1 | Bank 2 | playable | ⬜ |
| 9.2 | Bank 3 | playable | ⬜ |
| 9.3 | Bank 4 | playable | ⬜ |
| 9.4 | Bank 5 | playable | ⬜ |
| 9.5 | Remaining weapon tiers (SMG, shotgun, rifle, sniper) | stats from config | ⬜ |
| 9.6 | Minimap + vault-progress markers | markers update live | ⬜ |
| 9.7 | Killfeed + alarm/bounty events | events visible | ⬜ |
| 9.8 | Tutorial level | new player completes it | ⬜ |
| 9.9 | Round-end awards screen | awards shown | ⬜ |

---
## Phase 10 — Harden & ship  ⬜
| # | Subphase | Done when | Status |
|---|---|---|---|
| 10.1 | Rate limits on every message/route | limits tested | ⬜ |
| 10.2 | Anti-cheat validation (speed, fire rate, LOS) | cheat tests fail | ⬜ |
| 10.3 | 100 and 200 player load test | report in docs | ⬜ |
| 10.4 | Logging, metrics dashboards, backups | documented + working | ⬜ |
| 10.5 | Containers + deploy scripts | staging deploy works | ⬜ |
| 10.6 | Production deploy + release checklist | live | ⬜ |
