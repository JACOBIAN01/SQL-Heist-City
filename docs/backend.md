# Backend (game server)

Node.js + TypeScript, `ws`, `node:sqlite`, worker threads. Authoritative for everything.

## Process model
```
main process
 ├─ HTTP: /health, /metrics, /internal/reload (secret)
 ├─ lobby/matchmaker: assigns players to matches
 ├─ match worker #1..N (worker_threads)   ← one match each, up to MAX_PLAYERS
 └─ grader pool (worker_threads, size = cores-1)
```
`MAX_PLAYERS`: 60 / **100 (default)** / 200. Matches are isolated; scale out with more processes.

**Tutorial rooms (Phase 9.8):** `/ws/tutorial` on the main process (attached only when the question database exists). Each connection gets a `TutorialRoom`: its own `Match` on the tutorial map, three practice targets, a `TutorialCoach` and a `GameLoop` that stops when the player leaves (or after `maxMinutes`). Rooms prefix their player keys (`tutorial-<n>:p1`) because they share the one challenge system. The coach judges each step from server state (a Strategy per step id) and the `task_solved` heist event. A room costs one player's worth of ticking.

**As built (Phase 6.8):** `MatchPool` starts each match in a worker thread (`matchWorker.ts`) that owns its own HTTP/WebSocket listener, so matches never share an event loop; the main process keeps `/lobby` (which match has room, on which port), `/metrics`, `/health` and the SQL challenge socket. `MATCH_WORKERS=0` (default) keeps one match in-process. Sockets cannot be handed between threads in Node, which is why a match listens itself instead of the main process routing connections.

## Tick loop (20 Hz = 50 ms)
1. Drain `InputCommand` queues (validated, rate-limited).
2. Simulate: movement + static collisions, vehicles, cooldowns, respawns.
3. Resolve combat with lag compensation (history ring buffer, 200 ms).
4. Game rules: vault state, loot, banking, win condition.
5. Build per-client snapshots via AOI; send.
Target: <15 ms at 100 players. Per-tick metrics exported.

## AOI
Spatial hash, 64 m cells (= one city block/chunk, see `city-kit.md`); a second, finer grid (8 m) indexes static colliders so movement and shots only test nearby boxes. Client gets own + 8 neighbour cells; tiered rates (near <60 m 20 Hz, mid <120 m 10 Hz, far <200 m 5 Hz, beyond that nothing); cap 30 entities, all configurable (`interestSettingsSchema`). Events (shots, kills) have own relevance rules; vault progress goes on a low-rate global channel.

## Domain classes & patterns (why / how) — master index: design-principles.md
| Class / pattern | Why |
|---|---|
| `Match` (State: `MatchPhase`) | phases own their allowed actions; no giant conditionals |
| `Player` (State: `PlayerState`) | alive/dead/in-vehicle/solving rules isolated |
| `MatchEventBus` (Observer) | scoreboard, killfeed, metrics, bounty markers subscribe to `PlayerKilled`, `LockOpened`, `CashBanked`; no coupling |
| `RewardStrategy` + `RewardRegistry` (Strategy/Factory) | heal/gun/ammo/vault-lock are separate classes; new reward = new class (Open/Closed) |
| `BaseRewardStrategy` (Template Method) | every reward validates → applies → emits event the same way |
| `WeaponFactory` | weapons built from config rows, no hard-coded stats |
| `InputCommand` (Command) | uniform validation, rate limiting, lag-compensation replay |
| `ChallengeService` (Facade) | match code calls `issue()` / `submit()`; selector/variants/worker complexity hidden |
| `QuestionReader` (Repository + ISP) | server can only read; SQLite details hidden; fakes in tests |
| `Grader` + `RateLimitedGrader`/`MetricsGrader` (Decorator) | cross-cutting limits and metrics without touching grading logic |
| `SqliteSandboxAdapter` (Adapter) | isolates node:sqlite specifics |
| Snapshot/vector pools (Object Pool) | no per-tick allocation |
| Composition root `server/src/main.ts` (DIP) | the only place that `new`s concrete services |

## Combat
- Hitscan: ray vs. player capsules (head/body); server rewinds by client RTT/2 (capped 200 ms).
- Weapon stats from config (`settings.weapons.*`), not code.
- Spawn protection (default 5 s). Death drops carried cash; guns lost; banked cash and vault progress kept.

## Game server — built in Phase 5
Code: `server/src/game/`. Start: `npm run dev:server` (`/ws/game` binary socket; `/ws/challenge` JSON socket; one `UpgradeRouter` shares the HTTP port).

| Piece | File | Job |
|---|---|---|
| `GameLoop` | `GameLoop.ts` | 20 Hz drift-corrected timeline, skips ahead after a stall instead of bursting; `TickStats` (p50/p95/max tick ms) |
| `Match` | `Match.ts` | players, join/leave, per-tick input → movement → fire → respawn → history → snapshots. Socket-free: talks to `PlayerConnection` |
| `Player` | `Player.ts` | body, hp, weapon, cooldown, protection, input queue (dedup by sequence, capped) |
| `GameSocket` | `GameSocket.ts` | decodes frames strictly, 1 KB cap, 120 msg/s limit, join timeout, slow-client drop |
| `LagCompensator` | `LagCompensator.ts` | per-player position history (~0.4 s); `poseAt(tick)` blends between ticks |
| `SpawnPolicy` (Strategy) | `SpawnPolicy.ts` | farthest spawn from other players |

Rules enforced here (the client is never trusted):
- **Movement:** the same `stepBody` as the client; at most `maxCommandsPerTick` (6) commands per player per tick, so extra input cannot speed-hack. Walls and floors come from the shared map.
- **Firing:** the fire button is processed per command; the weapon cooldown counts down in *simulated* time (1/60 s per command), so fire rate cannot be beaten either. Bullet spread is seeded (`match|tick|player|seq`) for reproducible tests.
- **Hits:** ray from the camera pivot (eye + shoulder) vs. each target's upright-cylinder hit-box; walls block; head zone ×2; range per weapon. Spawn-protected and dead players cannot be hit.
- **Lag compensation:** targets are rewound by the command's `viewLagMs` (capped by `maxLagCompMs`, default 200) using only completed ticks, so every target is judged at the same moment. History is dropped on respawn so a teleport is never blended.
- **Death/respawn:** hp 0 → dead (input acknowledged but ignored), kill event, respawn after `respawnDelaySec` at the farthest spawn with `respawnHp` and spawn protection. All numbers in `shared/config/combat.ts`.
- **Sandbox only:** everyone holds `sandboxWeapon` (rifle) with no ammo limit; Phase 7 replaces this with SQL-earned guns.

## Challenge service (SQL)
| Module | File | Role |
|---|---|---|
| `ChallengeService` (Facade) | `server/src/challenges/` | issue / run / submit; one active challenge per player; lockout, expiry, cooldowns; skips broken questions |
| `QuestionSelector` | `server/src/challenges/` | enabled questions in the reward's tier range; no repeats per player+reward until the pool is used up; widens tiers if empty |
| `VariantBuilder` (Builder) | `server/src/variants/` | params + rendered story/reference + generated tables for one seed |
| `Grader` | `server/src/sql/` | reference result once per challenge, then grade / preview student SQL |
| `SqlSandbox` (Adapter) | `server/src/sql/` | in-memory node:sqlite DB, statement pre-check, authorizer allow-list |
| `WorkerSandboxRunner` (Object Pool) | `server/src/sql/` | worker threads; kills and replaces a worker on timeout |
| `ResultComparator` (Strategy) | `server/src/sql/` | ordered / unordered comparison, structured mismatch |
| `FeedbackBuilder` | `server/src/sql/` | non-leaky hints |
| `SettingsReader` | `server/src/config/` | lockout/TTL/cooldowns + reward→tier with admin overrides |

Seed = `matchSeed|player|rewardKey|attempt` — every re-request of a reward gets a new variant.

### Sandbox rules
Single statement, only `SELECT` / `WITH … SELECT`; SQLite authorizer allows reads of seeded tables only (denies ATTACH, PRAGMA, DDL/DML, extensions); `query_only=ON` + defensive mode; 2 s timeout enforced by terminating the grading worker; row cap 1000; worker `resourceLimits`; fresh in-memory DB per challenge (tables ≤200 rows).

### Comparison
Multiset unless `order_matters`; column order must match; names ignored by default; REAL tolerance 1e-6; NULL explicit; case-sensitive text by default. All via flags on the question.

### Lifecycle & limits
- One active challenge per player; binding `(playerId, reward, target, seed, expiresAt)`.
- Rate limits: Run 1/1.5 s, Submit 1/2 s, request 1/3 s (config).
- Wrong → lockout (config); hint cost deducted (config); reference/grader failure → cancel, no penalty.
- Reward applied atomically in the match thread.

## Config
Defaults in `shared/config/defaults.ts`; DB `settings` override; hot-reloaded on `/internal/reload`. Includes heal amounts, weapon→tier map, lock count, lockout, hint cost, respawn, round length, loot values.

## SQL sandbox isolation and fuzzing (Phase 18.4)
Student SQL runs in a pool of **child processes** (`WorkerSandboxRunner`, `isolation: 'process'`, the default), each with a 64 MB JS heap; a job over its time budget gets its process SIGKILLed and replaced. Threads are not enough: `node:sqlite` has no interrupt, so a thread stuck in a native SQLite loop (e.g. `COUNT(*)` over an endless recursive CTE) survives `terminate()`, keeps a CPU busy forever and stops the process from exiting. The fuzzer found this; `isolation: 'thread'` remains only for trusted SQL. Jobs first get a 150 ms budget; one that overruns is stopped and re-run in a slow lane limited to half the processes (with the rest of its time), and two ready spare processes replace killed ones at once, so runaway queries never hold up ordinary answers (Phase 19.3). `stats()` reports queue waits, timeouts and demotions.

`server/src/sql/fuzz/SqlFuzzer.ts` builds seeded hostile cases in six families (escape attempts, writes, resource bombs, oversized input, garbage, benign queries with a hostile tail; with case, comment and whitespace disguises) and checks: no escape statement succeeds and no canary file appears, writes only succeed in write tasks, the data reads back intact, results stay under the row cap, every job ends by the time limit, and the runner still works afterwards. 60 cases run in every CI; `npm run fuzz:sql -w @heist/server` runs any number, and `.github/workflows/nightly.yml` runs 10 000 each night with the date as seed.

## Observability
`/metrics` (tick ms p50/p95/p99, players, bytes/s, grader queue depth, grading ms); structured logs (pino); never log reference SQL at info.

## Rate limits (Phase 18.2)
Defaults in `shared/src/config/rateLimits.ts`; operators override with `RATE_LIMITS` (JSON merged over the defaults, on both the game server and the admin). Per-address limits are sized for a whole class behind one school address; tighter limits are per account or per connection. Behind a proxy set `TRUST_PROXY=1` so the first `X-Forwarded-For` address counts (otherwise the header is ignored).

| What | Limit (default) | Over it |
|---|---|---|
| New sockets per address (all `/ws/*`) | burst 400, 1200/min | 429 on the upgrade |
| Game socket messages per connection | 120/s | closed (1008) |
| Challenge, practice, assessment socket messages per connection | burst 20, 240/min | closed (4008) |
| Challenge request / Run / Submit per player | 3 s / 1.5 s / 2 s gaps, lockout after a wrong answer | `rate_limited` / `locked` |
| Game server HTTP (lobby, class status, health, metrics) per address | burst 400, 2400/min | 429 |
| Admin API per address | burst 120, 600/min | 429 |
| Sign-in routes (staff login, Google sign-in, tickets, class join) per address | burst 400, 1200/min | 429 |
| Failed staff logins per account | 5 per 15 min | 429 |
| Class-code guesses per player | 8, then 8/min | 429 |

Every row has a test that goes over it.

## Anti-cheat (Phase 18.3)
Client trust = none. The server simulates every move from input (at most `maxCommandsPerTick` commands a tick, so extra input buys no speed), spaces shots by the gun's cooldown, rewinds targets by at most `maxLagCompMs`, ends every ray at the first wall, and checks range and rules for every interaction and task. On top of that, independent audits feed `AnomalyLog` (`server/src/game/AnomalyLog.ts`):

| Anomaly | Raised when |
|---|---|
| `input_flood` | input arrives faster than real time and the queue drops commands |
| `lag_claim` | a command claims more lag than the server rewinds |
| `speed` | a body on foot moves further in a tick than the command budget at sprint speed allows (a physics bug) |
| `fire_rate` | one gun fires more in a second than its rpm allows (a skipped cooldown) |
| `hit_through_wall` | a hit's line from the gun crosses a wall (the hit is dropped) |
| `impossible_action` | an interaction out of reach or unknown, or an unknown task |
| `malformed` | a JSON message that does not match the protocol |

Each is counted (`/metrics` → `anomalies`) and written as one JSON log line (`{"anomaly":…}`), at most three per player and kind. `AntiCheat.test.ts` plays each cheat and checks it fails and is logged, and that honest play logs nothing.

## Load testing
`npm run load:bots -- --players 60,100,200 --seconds 20` runs a whole match in-process with scripted bots and prints the tick cost, bandwidth and garbage per tick. `--map city[:seed]` runs it in the real city with its parked cars, `--map sandbox` in the small yard, and the default is the city-sized bench map. `--mode socket --url ws://…` connects real WebSocket bots to a running server instead.

Measured in the perf pass (8.11, one laptop core, city map):

| players | tick mean | p99 | KB/s per client | garbage per tick |
|---|---|---|---|---|
| 60 | 0.8 ms | 1.3 ms | 2.9 | 0.4 MB |
| 100 | 1.4 ms | 1.8 ms | 3.5 | 0.5 MB |
| 200 | 3.7 ms | 5.4 ms | 4.3 | 1.0 MB |

All far inside the 15 ms budget. Car records in snapshots are reused like player records (the encoder copies what it compares), which took garbage at 100 players from 1.0 to 0.5 MB per tick.

## Bank layouts (Phase 7.1)
A bank is data: `BankLayout` (`shared/src/world/bank/`) lists the footprint, storeys, street entrance and, per storey, interior walls (with door/window openings) and blocks (counters). `compileBank(layout, at)` turns it into `MapBox` colliders; the outer shell is generated from the footprint, and the entrance cuts only the ground storey. `validateBank` rejects diagonal walls, overlapping openings and anything outside the footprint. Server and client call the same function, so they cannot disagree about a wall. Bank 1 ("Corner Savings") is `bank1.ts`; Bank 2 ("City Trust", 9.1) is `bank2.ts`: 26 × 22 m, four storeys, a split counter with two lobby pillars, offices behind a partition on storeys 1–2, a switchback stair in two 2 m lanes (A climbs to a landing at the back wall, B starts a metre off it and climbs forward, then A again), a lift on every storey and the vault on the top floor. Bank 3 ("Metro Capital", 9.2) is `bank3.ts`: 28 × 20 m, four storeys, the door off to the left (x = -6), a switchback running east–west against the east wall, desks on storey 1, offices on storey 2 and the vault at the front-left of the top storey, above the door, so the climb ends across the building from it. Bank 4 ("Grand Reserve", 9.3) is `bank4.ts`: 28 × 24 m, five storeys and the first with **two stair cores**, a switchback in each back corner (mirror images), so no single stairwell is the chokepoint; a 4 m door onto a pillared lobby, offices, a records room and desks on storeys 1–3, and the vault at the centre-back of the top storey between the cores. Bank 5 ("Federal Vault", 9.4) is `bank5.ts`: 28 × 28 m, six storeys, in the city centre. Its climb is **split**: a back-west switchback reaches storey 3 and a second one in the front-east corner goes on to the top, so every crew crosses the open storey-3 trading floor; the vault sits behind an anteroom (an always-open door, the console, then the vault door) with eight loot spots. Chairs are solid furniture, and a bank's street cash machine (`facade.atm`) is a collider on the pavement. Every tier now has a layout. `BANK_LAYOUTS` lists every laid-out bank by tier; the city builds each on its tier's site and would stand a closed shell where a tier had none. `banks.test.ts` checks every layout the same way (valid, fits a 28 × 28 m lot, a lift per storey, pads and loot on free floor, the door seals the vault and opens with it) and walks each bank's climb with the real movement code. The `heist` map (`heistMap.ts`) puts it on a walled lot. Select a map with `MATCH_MAP=heist` on the server and `?map=heist` on the client (both resolve through `mapById`).

Furniture (11.2): a layout's `furniture` lists interior-kit pieces (`piece`, `storey`, `x`, `z`, `facing`, `scale`, `y`, `solid`). `placeFurniture(layout, at)` turns them into world placements (quarter turns, so footprints stay boxes; ceiling lights hang from the slab above, or the roof on the top storey). The compiler adds a `furniture` collider for every `solid` piece, capped at its ceiling; decoration (plants, carpets, lights) only exists in the art. Piece bounds live in `furniturePieces.ts` (the server cannot read the client's `interior.json`; a client test keeps the two equal). `validateBank` rejects unknown pieces, missing storeys and pieces outside the walls, and `banks.test.ts` keeps solid pieces clear of every stair run, anchor, loot spot, vault door and the street door. `facade` (pilasters, lamps, ATM, plaque; validated to lie along the front) and `fixtures` (teller screens, queue posts) are art-only and validated to lie inside the footprint on a real storey; they never collide. A vault's `fittings` (deposit-box walls and cash shelves, each a run along a wall facing into the room) compile to solid `furniture` colliders 2.2 m tall, 0.35 m deep. Compiled maps list their banks (`GameMap.banks`: tier and centre) so the client can draw the furniture from the same placements (`BankFurnitureArt`), hiding the stand-in boxes once the kit has loaded.

Floors and stairs (7.2): `stairs` in the layout lists straight flights (`storey`, footprint centre, width, heading, steps, tread). The compiler emits one box per step (rise = storey height ÷ steps, at most 0.3 m so `stepHeight` walks it) and cuts a matching hole in the slab above, so the climb has headroom. Flight 1 of Bank 1 reaches a landing on storey 1; flight 2 starts a metre off the back wall (a body is 0.7 m wide, so it needs room to step on) and reaches the top storey. Tests drive the real `stepBody` along waypoints to prove both floors are reachable.

Vaults (7.4): a `VaultSpec` in the layout gives a door blocker, a console and loot spots; it compiles to `MapVault`, `MapDoor` and a `vault_console` anchor. The door is kept out of the fixed boxes: `mapWithClosedDoors(map, closedIds)` returns a cached map variant (one per set of closed doors), so server and client swap collision state without mutating an indexed map. On the server `Vault` tracks lock progress (shared by everyone, kept for the round, locks open strictly in order, a second solver of the same lock changes nothing); `VaultRegistry` holds them; `VaultConsoleHandler` answers F at the console with `open_task` for the next lock (`vault:bank-<tier>:lock-<k>`). `HeistController.openLock` (called by the SQL reward in 7.5) advances the vault, swaps the match's collision map and broadcasts `vaults` (also sent on join). Lock count comes from `HeistSettings.locksPerVault` (settings key `heist`, default 3).

SQL tasks in a match (7.5): `HeistController` sits between the player's JSON and the challenge system (`ChallengeGateway`, satisfied by `ChallengeMessageHandler`). `TaskRules` is a registry of `TaskRule`s (`handles`, `check`, `grant`); `VaultLockRule` is the first. Answers are applied when grading finishes, on the event loop between ticks, and dropped if the player left meanwhile. In worker mode each match thread opens its own read-only database handle and challenge stack (`dbPath` in `MatchWorkerData`), so asking and grading never wait on another thread; `POST /internal/reload` reaches them through `MatchPool.reload()`.

Loot and cash (7.6): when the last lock opens the vault's cash (`HeistSettings.vaultLootByTier`) is split evenly over its loot spots as bags (`LootManager`). Each tick `HeistController.onTick` lets an alive player within `bagPickupRadius` (same storey) take a bag; `setCash` is the only place cash changes, so the speed penalty (`carrySpeedScale`: −10% per $100k up to −30%, both configurable), the `Carrying` flag and the player's `purse` message stay in step. A death or disconnect drops the carried cash as a bag where the player stood; revealing a hint for the first time deducts its cost (a fraction of carried cash, or a fixed amount, never more than carried). `stepBody` takes a `speedScale` so client prediction matches.

Banking (7.7): `SafehouseHandler` starts a `BankingService` channel (kept per player, counted in ticks). Each tick the service finishes channels that ran their time (cash moves carried → banked through `HeistController.setCash`) and cancels those whose player died or walked out of reach; `Match.damage` cancels on any damage (`onDamaged`), death and disconnect cancel too (the cash then drops as a bag). Safehouse sites are map anchors; the heist lot has three (Phase 8 places them on city blocks).

Guns and ammo (7.9): heist maps set `unarmedStart`; a player owns an `arsenal` (gun → rounds in its magazine), holds one (`weaponId`/`weaponWire`) and loses them all on death. `GunRule` (`gun:<id>`, refused if held or unknown) and `AmmoRule` (`ammo:refill`, refused when full or unarmed) are `TaskRule`s; `fire()` spends one round per shot and refuses at zero (the sandbox rifle has `infiniteAmmo`). Snapshots carry the held weapon index and rounds in `self`; `arms` JSON carries the owned list. The client predicts trails with `ammo − shots not yet acknowledged`, so an empty gun draws no phantom trail.

Rounds (7.12): on maps with vaults `HeistController` owns a `RoundController`. A round lasts `roundMinutes` (15); new players may join during the first `joinWindowMinutes` (3) and between rounds. Once every vault is open and no bag lies on the ground the round ends after `overtimeSeconds` (time to bank). At the end the winner (most banked, then kills, then earliest join; none if nobody banked) is announced, damage, interactions and tasks are refused and banking is cancelled for `intermissionSeconds`, then `resetWorld` starts a fresh round (vaults shut, bags gone, every player at full health, empty-handed, score zero, at a street spawn). All timing is in ticks on the match clock. `rankPlayers` is the one ranking function; the scoreboard broadcasts the top 10 and tells each player their rank only when it changes, so it costs a few hundred bytes per interval.

## The city (Phase 8.2)
The city is data too. `generateCity(settings, bankFootprint)` (`shared/src/world/city/`) builds a `CityLayout` from `CitySettings` (`shared/src/config/city.ts`): a `blocks × blocks` grid on a 64 m pitch (52 m block + 12 m street, 3 m sidewalks) with an outer ring street.
- **Determinism:** it uses one seeded random stream, and each block forks its own stream, so the same settings always give the same city. No geometry is ever sent over the network.
- **Lots:** each block's inner area splits into four lots with 4 m alleys between them, sized on the 2 m kit grid. A lot is one or two solid buildings (taller downtown) or an open plaza.
- **Special sites:** these always take a block's front (+z) lot, so entrances face the street.
  - **Banks:** 5 sites, tier 5 in the most central block and tier 1 on the outskirts. Each site reserves the footprint of its tier's `BankLayout` (`BANK_LAYOUTS`; tiers without a layout reserve Bank 1's size and stand as a closed building until Phase 9).
  - **Safehouses:** 3, placed as far from the banks and from each other as the grid allows.
  - **Hospital:** the most central free block, with an 8 m forecourt holding the beds.
- **Spawns:** twelve per segment of the inner streets (the outer ring only looks at the city wall), on the asphalt, one in each lane, facing along the street.

`compileCity(id, layout, BANK_LAYOUTS)` turns the layout into a `GameMap`:
- boundary walls;
- a 0.15 m kerb ring per block (below `stepHeight`, so it is walked over);
- building shells, plus Bank 1 compiled from its layout at its site (anchors, door, vault);
- safehouse pads (`safehouse-1..3`), hospital beds as `respawns`, and street spawns.

It also attaches the layout as `map.city`, which the client uses to build the art. The default city has 279 colliders, takes 9 ms to build, and is 332 m across.

Map ids: `mapById('city')` builds the default seed and `mapById('city:<seed>')` builds any other seed (1–64 characters, `[A-Za-z0-9_-]`). Each id is built once and cached (Flyweight), so the collision grid cached per map object stays valid. The city is the **default map** (since 8.3): `npm run dev:server` serves it with no settings, `MATCH_MAP=city:<seed>` picks another seed, and `MATCH_MAP=sandbox|heist|bench` brings back the test maps. The client builds the city when there is no `?map`, and on `welcome` reloads itself onto the server's map id if they differ (`followServerMap`). Tests sweep 4–8 blocks × several seeds for invariants: lots inside blocks, no overlaps, streets free of colliders, spawns and beds on free ground. They also check that regenerating a city gives identical colliders, and walk a body from the street over the kerb into Bank 1 and up to a safehouse pad.

City settings are defaults only. Admin overrides of the size are deferred, because the client has to generate the same city: an override has to travel inside the map id the way the seed does.

## PostgreSQL as the system of record (13.3)
- **Admin:** every store is an async interface (`QuestionStore`, `UserRepository`, `SessionStore`, `AuditLog`, `PoolRepository`, `SettingsStore`) with a SQLite and a PostgreSQL implementation, built as one family by `sqliteStores(db)` or `pgStores(pg)` (`admin/src/stores.ts`). `DATABASE_URL` selects PostgreSQL; without it the admin uses the SQLite file (`DB_PATH`). Both run the same contract tests.
- **Game server:** with `DATABASE_URL` it copies the content it reads (questions, topics, settings, reward map) into a local SQLite snapshot (`SNAPSHOT_PATH`) at start and on every admin reload (`syncContent`), so the 20 Hz loop and the challenge code stay synchronous and never wait on the network.
- **Commands:** `node scripts/pg-dev.mjs start` (private dev cluster, port 54329), `npm run db:migrate`, `npm run db:import-sqlite` (one-shot copy of `data/dev.db`).
- **Tests:** PostgreSQL tests use `TEST_DATABASE_URL` (CI service container) or start the private cluster; each test file gets its own schema. With no PostgreSQL reachable they are skipped with a warning.
