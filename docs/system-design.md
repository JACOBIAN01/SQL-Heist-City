# System Design Concepts

The important system-design ideas this project relies on: what each is, where we use it, and why. (Code-level OOP/SOLID/patterns are in `design-principles.md`; this file is about the system as a whole.)

## 1. Client–server authority (authoritative server)
- **What:** the server owns the truth; clients send *intentions* (inputs), never results.
- **Where:** damage, health, cash, inventory, vault state, grading, cooldowns are all decided on the server.
- **Why:** players are students with browser dev tools. Trusting the client would make cheating trivial. Also the only way to keep 100 clients consistent.

## 2. Real-time communication: WebSockets + binary protocol
- **What:** one long-lived, full-duplex connection per player; compact binary frames for high-rate data, JSON for rare messages.
- **Where:** `ws` on the game server; `shared/` defines the codec.
- **Why:** HTTP polling is too slow/heavy for 20 Hz updates. Binary + quantisation keeps bandwidth <4 KB/s per client.

## 3. Game loop & fixed tick rate
- **What:** the server simulates in fixed steps (20 Hz = 50 ms) rather than reacting to each message.
- **Where:** match worker tick: inputs → simulate → combat → rules → snapshots.
- **Why:** deterministic, predictable CPU cost, easy to budget (<15 ms/tick) and to reason about lag compensation.

## 4. Latency hiding: prediction, reconciliation, interpolation
- **Client-side prediction:** local player moves instantly; server confirms later.
- **Reconciliation:** if the server disagrees, client rewinds to the server state and replays unacknowledged inputs (needs sequence-numbered `InputCommand`s).
- **Interpolation:** remote players render ~100 ms in the past between two snapshots, so motion is smooth despite jitter.
- **Why:** the game feels responsive at 100+ ms ping without giving the client authority.

## 5. Lag compensation
- **What:** server keeps ~200 ms of position history and rewinds targets to what the shooter saw when firing.
- **Why:** "I shot him on my screen" should usually count; capped to limit abuse ("shooting around corners").

## 6. Area of Interest (AOI) & interest management
- **What:** each client only receives entities near them, via a **spatial hash grid** (64 m cells). Tiered rates: near 20 Hz, mid 10 Hz, far 5 Hz; hard cap ~30–40 entities per snapshot.
- **Why:** sending all 100–200 players to everyone is O(N²) bandwidth and CPU. AOI makes it roughly O(N·k). This is the key to scaling player count.

## 7. State synchronisation: snapshots + delta compression
- **What:** server sends periodic snapshots; each is a **delta** against the last snapshot the client acknowledged, with **quantised** values (16-bit positions, 8-bit angles, hp buckets) and bitmasks for changed fields.
- **Why:** big bandwidth saving; acknowledgements make it robust to packet loss.

## 8. Concurrency model: worker threads
- **What:** Node is single-threaded, so: **one match per worker thread** and a separate **grader worker pool**.
- **Why:** a slow SQL query or a busy match can't stall the tick of another match or the lobby. Hard timeouts + `resourceLimits` bound damage from bad queries.
- **Scale-out:** more matches = more threads/processes; the lobby assigns players (stateless routing by match id).

## 9. Horizontal & vertical scaling strategy
- **Vertical first:** 1 core per 100-player match + cores for grading.
- **Horizontal:** matches are isolated units → add processes/machines; a lobby/matchmaker routes. No cross-match shared state, so no distributed locking.
- **Limit:** one SQLite file means game server and admin share a host/volume; moving to Postgres lifts this (see §14).

## 10. Sandboxing untrusted code (the SQL grader)
- **What:** student SQL is untrusted input executed on our CPU.
- **Defences (defence in depth):** parse check (single `SELECT`/`WITH`), SQLite **authorizer** (deny ATTACH/PRAGMA/DDL/DML/extensions), `query_only`, **timeout** via progress handler, **row cap**, **memory limit**, **worker isolation**, fresh in-memory DB per challenge, per-player **rate limits**.
- **Why:** one infinite recursive CTE or `ATTACH` must not hurt other players or leak data.

## 11. Anti-cheat & anti-sharing by design
- **Answer-sharing resistance:** **seeded variants** — per-player/attempt seed changes parameters and generated data, so a friend's copied query returns different rows. Selector avoids repeats per player.
- **Solution secrecy:** reference SQL never leaves the server; challenge is bound to `(playerId, reward, target, seed, expiry)`, so a submit can't be replayed or redirected.
- **Gameplay validation:** server checks speed/teleport, fire rate, ammo, line-of-sight.
- **Trade-off acknowledged:** real-time web games can't be cheat-proof; goal is to make cheating costly and answer sharing ineffective.

## 12. Data-driven design / configuration over code
- **What:** questions, tiers, reward mapping, hint costs, lockouts, heal amounts, weapon stats, loot values all live in the DB/config, not code.
- **Where:** admin service edits → game server **hot-reloads** caches via an internal signal; active challenges keep their original version (**snapshot isolation** of in-flight work).
- **Why:** teachers tune the game without deploys; balance changes are data changes.

## 13. Separation of services (admin vs game)
- **What:** two Node services with different risk/traffic profiles: low-traffic, authenticated admin (Express + React) vs high-traffic real-time game server.
- **Why:** an admin bug or login attack can't affect match latency; different auth model, scaling and deploy cadence. Interface: shared DB (read-only for game) + `POST /internal/reload`.

## 14. Persistence & data modelling
- **Persistent SQLite file:** questions, **version history** (immutable snapshots → rollback), hints, reward map, settings, users, **audit log**, optional attempts/analytics. WAL mode for one writer + many readers.
- **Ephemeral state:** live match state stays in memory only.
- **Repository abstraction** keeps the door open for Postgres when multi-host is needed.
- **Soft delete + versioning** protect teachers' content from mistakes.

## 15. Security architecture
- Authn/z: argon2 password hashes; httpOnly + sameSite=strict session cookies; **RBAC** (admin, teacher) enforced per route; CSRF protection; login rate limiting.
- **Input validation at every boundary** with shared zod schemas (WS messages, REST bodies, imported files).
- **Rate limiting** per message type and per route; max message size.
- **Least privilege:** game server has read-only DB access (ISP/`QuestionReader`).
- Secrets via env; `/internal/*` protected by shared secret.

## 16. Caching
- Game server keeps questions/settings in memory caches, invalidated by the reload signal (cache invalidation on write, no TTL guessing).
- Client caches static assets via CDN with content hashes; large assets streamed.

## 17. Performance engineering
- **Budgets as requirements:** <8 MB first load, 60 fps integrated GPU, <200 draw calls, <400k tris, server tick <15 ms @100 players.
- **Client:** instancing, texture atlases + KTX2, baked lighting, LOD/imposters, chunk streaming, limited shadows, light post-FX.
- **Server:** **object pools** and typed arrays in hot loops, no per-tick allocation, spatial hashing instead of O(N²) scans.
- **Measure, don't guess:** metrics + bot load tests before and after each optimisation.

## 18. Procedural generation & determinism
- Seeded RNG everywhere (city layout, question variants, loot). Same seed → same result, so clients regenerate the city locally from a seed instead of downloading it (**tiny payload**), and tests are reproducible.

## 19. Event-driven architecture inside a match
- An in-process **event bus** (`PlayerKilled`, `LockOpened`, `CashBanked`, `ChallengeSolved`) decouples rule code from consumers (scoreboard, killfeed, bounty markers, metrics, audit). Features are added by subscribing, not by editing core logic.

## 20. Resilience & failure handling
- Grader crash/timeout → cancel challenge, **no penalty** to the player, log and alert.
- Worker crash → supervisor restarts it; a match-worker crash ends only that match.
- Disconnect/reconnect: grace window; vault lock progress and banked cash survive; carried cash drops.
- Graceful degradation: lower snapshot rates for far entities before dropping near ones.
- Idempotent reward application (a challenge can be solved once; duplicate submits ignored).

## 21. Observability
- Metrics (`/metrics`): tick ms p50/p95/p99, players, bytes out/s, grader queue depth and latency.
- Structured logs (pino) with match/player ids; never log reference solutions at info.
- Health endpoints; later dashboards and alerts.
- Audit log for all admin changes.

## 22. Testability by design
- Dependency injection + fakes (`FakeClock`, `FakeRng`, `FakeTransport`, `InMemoryQuestionRepository`).
- Deterministic simulation (seeded) enables replayable bug reports.
- Bot-based **load testing** (60/100/200 players, simulated latency/loss) is a first-class tool from Phase 6.

## 23. Trade-offs we chose (and why)
| Decision | Gain | Cost / mitigation |
|---|---|---|
| Browser + Three.js | zero install, small | lower fidelity than native → art direction + tricks |
| Hitscan weapons | cheap, simple netcode | no projectile drops → fine for target feel |
| Hitscan + lag compensation | fair at high ping | slight "shot behind cover" → 200 ms cap |
| WebSocket (TCP) | simple, universal | head-of-line blocking → small packets, snapshot deltas; WebTransport later |
| SQLite | zero-ops, same engine as grader | single host → repository allows Postgres later |
| Per-match worker | isolation | memory per match → bounded by MAX_PLAYERS |
| Empty city (no NPCs) | big CPU/bandwidth savings, fits the lore | less ambient life → atmosphere via audio/lighting |

## 24. Capacity back-of-envelope (to be verified in Phase 6/10)
- 100 players × ~3 KB/s ≈ 300 KB/s per match outbound; 200 players ≈ 600 KB/s.
- Tick budget 15 ms of 50 ms leaves headroom for GC and grading dispatch.
- Grading: tables ≤200 rows, ≤200 ms typical; a 4-worker pool handles ~20 submissions/s, far above human typing rate.
