# Phases

Rule: after each phase → stop → summary → **user approves** → next phase. Every phase has multiple small commits (suggested commit breakdown listed; may be refined).

---
## Phase 0 — Docs & scaffold
**Goal:** agreed design docs + empty-but-working monorepo.
- 0a Docs (this folder) → **user reviews docs before 0b**.
- 0b Scaffold: npm workspaces (`client server admin shared`), TS configs, ESLint, Prettier, Vitest, CI workflow, `.gitignore`, `.editorconfig`.
- 0c Hello-world per workspace (client page, server `/health`, admin `/health`), `npm test` green.

**Commits:** docs per file group · workspace skeleton · tooling · hello-world per workspace · CI.
**Exit:** `npm install && npm test && npm run lint` pass; docs approved.

---
## Phase 1 — Question engine (server, no UI)
**Goal:** store, vary, and grade SQL questions safely.
- DB schema + migrations (questions, versions, tiers, reward_map, settings).
- Question template format + variant DSL (seeded RNG, parameters, data generators).
- Sandboxed grader (worker thread, authorizer, timeout, row cap).
- Result-set comparator (order-insensitive unless flagged, alias-tolerant).
- Challenge selector (per reward + tier, no repeats per player, seeded).
- Hint/diff feedback without leaking solution.

**Commits:** schema · RNG+DSL · data generators · sandbox · comparator · selector · feedback · tests per piece.
**Exit:** Vitest suite proves: equivalent queries pass, wrong fail, dangerous SQL blocked, infinite recursion killed, two seeds → different expected rows.

---
## Phase 2 — Admin backend + UI (Node)
**Goal:** teachers configure everything about questions.
- Auth (login, roles admin/teacher), audit log.
- Question CRUD, enable/disable, duplicate, version history + rollback.
- "Test this question": run reference solution on N seeds, preview variants, try a student query.
- Bulk import/export (JSON, CSV).
- Config editor: reward→tier mapping, costs, lockout, hint cost, heal amounts, per-match pools.
- Hot-reload signal to game server.

**Commits:** auth · CRUD API · versioning · preview/test endpoint · import/export · config API · UI shell · question list/editor · preview UI · config UI.
**Exit:** edit a question in the UI → next challenge request reflects it with no restart.

---
## Phase 3 — Seed content (150 questions)
**Goal:** ship 150 curated questions across 5 tiers, all editable.
- Curriculum map (see `questions.md`), 30 per tier.
- Authoring in JSON, loaded via admin import (not hard-coded).
- `questions:validate` script: runs each reference solution against 20 seeds; checks non-empty/unique results, runtime, no solution collisions between variants.

**Commits:** per tier (5 commits) · validator · fixes.
**Exit:** validator green for all 150; spot-check by user in admin UI.

---
## Phase 4 — SQL pop-up UI (client)
**Goal:** LeetCode-style panel, standalone demo against real server.
- Layout (story / schema / sample rows | editor / results), CodeMirror 6 SQL, Run (free preview) vs Submit (graded), timer, lockout, hint button, task-switch menu, non-blocking overlay.
- Draft persistence across switch.

**Commits:** panel shell · editor · result table · run/submit wiring · lockout/hint · quick-switch · styling/responsive.
**Exit:** demo page solves a question end-to-end; bundle impact measured.

---
## Phase 5 — Walk & shoot sandbox
**Goal:** feel of movement and combat with 2+ real players.
- Three.js scene, third-person camera, movement/jump/crouch, test block map.
- WS server, binary protocol, tick loop, join/leave.
- Prediction + reconciliation, interpolation.
- Hitscan with lag compensation, health, death/respawn.

**Commits:** scene · input/controller · camera · server tick · protocol · prediction · interpolation · weapons · damage.
**Exit:** two browser tabs shoot each other smoothly at 100 ms simulated latency.

---
## Phase 6 — Scale core (60 → 100 → 200)
**Goal:** prove the player count.
- Spatial-hash AOI, tiered update rates, delta snapshots, buffer pooling.
- Bot harness (`load:bots`), metrics (tick ms, bytes/s, GC).
- Worker-thread-per-match option.

**Commits:** spatial hash · AOI · delta snapshot · pooling · bots · metrics · tuning.
**Exit:** 100 bots, tick <15 ms, <4 KB/s/client; 200-bot results documented (pass or known limits).

---
## Phase 7 — Heist loop v1
**Goal:** the core game, one bank.
- Bank 1 (3 floors) interior, doors, stairs/elevator.
- Vault with 3 locks → SQL challenges via server, persistent lock state.
- Loot, carrying, drop-on-death, safehouse banking, scoreboard.
- Heal & gun unlock via SQL (config-driven tiers), ammo refill.
- Death/respawn at hospital, spawn protection.

**Commits:** bank map · interaction system · vault state · challenge wiring · loot · banking · heal · guns · respawn · HUD.
**Exit:** full loop playable with 3+ players.

---
## Phase 8 — City, vehicles, atmosphere
- Procedural chunked city (seeded), streaming, instancing.
- 3 vehicles + simple physics.
- Day/night, fog, post-FX, spatial audio.

**Exit:** 60 fps on integrated GPU; <8 MB first load.

---
## Phase 9 — Banks 2–5, weapons, UX
- 4 more banks (3–6 floors, rising loot/difficulty), 5 weapon tiers, minimap, vault-progress bounty markers, tutorial, killfeed, scoreboard.

---
## Phase 10 — Harden & ship
- Rate limits, anti-cheat checks, 100–200 player load test, perf pass, logging/metrics, deployment docs and deploy.
