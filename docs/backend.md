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
