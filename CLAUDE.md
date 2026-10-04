# CLAUDE.md — SQL Heist City

Project brief and conventions for any Claude session working in this repo. Read `docs/rules.md` and `docs/Phases.md` before doing anything.

## What this is
A lightweight, browser-based, multiplayer 3D game (target **100 players/match**, configurable 60–200). Players are students in an empty city with **5 multi-floor banks**. They break vaults and collect cash. **Every meaningful action — opening a vault lock, healing, unlocking a gun, refilling ammo — requires solving a SQL question** shown in a LeetCode-style pop-up. The world never pauses while the pop-up is open, so a player can be shot mid-query and must choose: keep solving, heal, or get a gun. The question for the same reward differs per player (seeded variants).

## Non-negotiable rules (summary — full text in docs/rules.md)
1. **Phase gating.** Do one phase at a time (docs/Phases.md). At the end, stop, summarise, wait for explicit user approval.
2. **Multiple small, meaningful commits per phase.** One logical change per commit. Never one big commit.
3. **Questions are 100% configurable.** No question text, tier, reward value, cost, lockout, or hint hard-coded in game code. All live in the DB and are editable via the admin backend.
4. **Server-authoritative.** The client never sees reference solutions, never decides damage, cash, or grading.
5. **Performance budgets are requirements:** <8 MB first load, 60 fps on integrated GPU, server tick <15 ms at 100 players.

6. **OOP + SOLID + design patterns where they earn their place** (full rules in docs/rules.md §6 and docs/design-principles.md). Every pattern/SOLID application gets a short `// Why:` comment at the class/interface explaining the benefit. No patterns for decoration.

## Stack
- Client: TypeScript, Vite, Three.js, CodeMirror 6 (SQL)
- Game server: Node.js + TypeScript, `ws`, binary protocol, 20 Hz tick
- Admin: Node.js + Express REST API + React web UI (Vite)
- DB: SQLite via Node's built-in `node:sqlite` (questions, users, configs) — chosen over better-sqlite3 for its authorizer hook, which the SQL sandbox relies on; in-memory SQLite for grading sandboxes. Requires Node ≥ 24
- Tests: Vitest; Playwright for UI smoke tests
- Monorepo with npm workspaces: `client/ server/ admin/ shared/`

## Layout
```
client/   browser game + SQL pop-up
server/   authoritative game server, grader, variant generator
admin/    question/config management API + UI
shared/   protocol types, constants, schemas (zod)
docs/     all design docs (this folder is the source of truth)
```

## Commands
```
npm install
npm run dev:server     # game server  http://localhost:8080  (/health)
npm run dev:admin      # admin API :8081 + React UI http://localhost:5174
npm run dev:client     # game client  http://localhost:5173
npm test               # vitest, all workspaces
npm run lint | typecheck | format
npm run build          # admin UI + client bundles
npm run ci             # everything CI runs: format check, lint, typecheck, test, build
npm run db:seed        # import content/questions/*.json (skips existing; --update to overwrite)
npm run questions:validate   # QA gate for content files (100 seeds each)
npm run user:create -w @heist/admin -- --email you@school.test --password '…' [--role admin|teacher]
npm run bot -w @heist/server -- 3    # dev bots that walk in circles (needs the game server running)
npm run load:bots -- --players 60,100,200 --seconds 20   # server tick cost per player count (in-process; add --mode socket for real clients)
```
- TypeScript is pinned to 6.0.x until typescript-eslint supports 7.
- Game server env: `PORT` (default 8080), `MATCH_WORKERS=N` runs N matches each in its own thread on its own port (clients ask `GET /lobby` where to connect; 0 = one in-process match), `/metrics` serves tick time, players and bandwidth.
- Admin env: `DB_PATH` (default `data/dev.db`), `ADMIN_EMAIL` + `ADMIN_PASSWORD` (create the first admin on an empty DB), `INTERNAL_SECRET` + `GAME_SERVER_URL` (hot reload to the game server; same `INTERNAL_SECRET` on the game server).

## Conventions
- TypeScript strict, no `any` without a comment. ESM everywhere.
- Shared message/types only in `shared/`; never duplicate a type across workspaces.
- Config over constants: gameplay numbers live in `shared/config` defaults + DB overrides.
- Commit messages: imperative, <=72 chars subject, body explains why. Tests ship in the same commit as the code.
- Comments only where the *why* is non-obvious.

## Doc index
Architecture.md · system-design.md · Phases.md · rules.md · design-principles.md · frontend.md · backend.md · admin.md · questions.md · gameplay.md · api-protocol.md · testing.md · deployment.md · city-kit.md (all in `docs/`)
