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

## Observability
`/metrics` (tick ms p50/p95/p99, players, bytes/s, grader queue depth, grading ms); structured logs (pino); never log reference SQL at info.

## Anti-cheat basics
Validate speed/teleport, fire rate, ammo, line of sight, challenge binding. Client trust = none.

## Load testing
`npm run load:bots -- --players 100 --latency 100 --loss 0.05`.

## Bank layouts (Phase 7.1)
A bank is data: `BankLayout` (`shared/src/world/bank/`) lists the footprint, storeys, street entrance and, per storey, interior walls (with door/window openings) and blocks (counters). `compileBank(layout, at)` turns it into `MapBox` colliders; the outer shell is generated from the footprint, and the entrance cuts only the ground storey. `validateBank` rejects diagonal walls, overlapping openings and anything outside the footprint. Server and client call the same function, so they cannot disagree about a wall. Bank 1 ("Corner Savings") is `bank1.ts`; the `heist` map (`heistMap.ts`) puts it on a walled lot. Select a map with `MATCH_MAP=heist` on the server and `?map=heist` on the client (both resolve through `mapById`).

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
