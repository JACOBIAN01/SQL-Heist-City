# Performance record

Numbers measured on a developer laptop (Apple silicon, Node 24), recorded per phase so regressions are visible. Targets from `docs/backend.md`: **server tick < 15 ms at 100 players**, **< 4 KB/s per client**, no per-tick garbage pile-up.

Tools: `npm run load:bots -- --players 60,100,200 --seconds 20` (in-process, no network) and `npm run load:bots -- --mode socket --players 100 --url ws://localhost:8090/ws/game` (real WebSocket clients against a running server; read `GET /metrics` while it runs).

Bench map: a 640 m square with ~270 building boxes, spawns spread over it (`server/src/loadtest/benchMap.ts`); bots wander, 30% sprint, 10% hold fire.

## Phase 6.3 — baseline, before any optimisation
Every client is sent every player at 20 Hz in float32 (20 B per entity), one allocation-heavy snapshot per client per tick.

### In-process (simulation + encoding, no sockets)
| players | tick mean | p95 | p99 | max | KB/s per client |
|---|---|---|---|---|---|
| 60 | 0.61 ms | 0.79 | 0.93 | 1.04 | 24.6 |
| 100 | 1.15 ms | 1.39 | 1.52 | 1.65 | 40.8 |
| 200 | 3.28 ms | 3.83 | 4.21 | 7.53 | 81.0 |

### Real server, 100 socket bots on the same machine
| metric | value |
|---|---|
| tick p50 / p95 / p99 / max | **9.6 / 12.7 / 15.3 / 19.1 ms** |
| bandwidth | 4.1 MB/s total, **40.9 KB/s per client** |
| snapshots | 20 per client per second |
| client round-trip p50 / p95 | 0.3 / 9.1 ms |

### What this tells us
- **Simulation is cheap** (about 1 ms for 100 players). The expensive part is **sending**: with real sockets the tick is ~8 ms slower because ~2000 snapshots per second are written to 100 sockets from inside the tick.
- **Bandwidth is 10× over target** (41 KB/s vs 4 KB/s) because everyone receives everyone at the full rate. This is what Phase 6's interest management, delta and quantisation (6.5, 6.6) attack, and it is also what brings the tick time down.
- 200 players is ~4× the bytes of 100 per client (quadratic): hopeless without area-of-interest.

## Phase 6.4 — spatial grids
Static colliders are bucketed in an 8 m grid (`shared/src/world/ColliderGrid.ts`); `stepBody` and every ray (shots, camera) look only at nearby boxes. Players get a `SpatialGrid` for the interest management in 6.5. Property tests check the grid against a brute-force scan on thousands of random rectangles and rays.

| players | tick mean before → after | p99 before → after |
|---|---|---|
| 100 | 1.15 → **0.67 ms** | 1.52 → 1.06 ms |
| 200 | 3.28 → **2.30 ms** | 4.21 → 3.34 ms |

The gain grows with the number of boxes: this bench map has ~270; the real city will have 500–1000.

## Phase 6.5 — area of interest and tiered rates
(Ranges below are the 6.5 values; 6.9 tuned them to 60/120/200 m and 30 players.) Each client now gets itself every tick plus only the other players its interest policy says are due: within 60 m every tick (20 Hz), within 150 m every 2nd (10 Hz), within 250 m every 4th (5 Hz), beyond that nobody; at most 40 others, nearest first. Newcomers in range are sent immediately. Shots are delivered only to players within 250 m of the shooter or the impact; kills, joins and leaves stay global. Ranges and rates are settings (`interestSettingsSchema`). The client draws players it hears about less often further behind (1.5 update intervals) so they still move smoothly.

| players | KB/s per client before → after | tick mean |
|---|---|---|
| 100 | 40.8 → **5.8** | 0.67 → 1.28 ms |
| 200 | 81.0 → **11.3** | 2.30 → 4.03 ms |

Bandwidth falls ~7×; the tick cost rises a little (distance sorting per viewer), which 6.7 will claw back.

## Phase 6.6 — delta compression and quantisation
Snapshots carry only what changed for that client: positions as 2 cm int16 (or 3 signed bytes as a delta from the last value that client received), yaw/pitch one byte, flags/hp only when they change, and a standing player costs nothing. The client keeps the same baseline (`SnapshotDecoder`), so no acknowledgements are needed over WebSocket. Removed-from-interest players are listed explicitly instead of timing out. Protocol version 2.

| players | KB/s per client before → after | notes |
|---|---|---|
| 100 | 5.8 → **2.7** | under the 4 KB/s target |
| 200 | 11.3 → **4.4** | close; tuning in 6.9 |

(Compared with the original, 41 → 2.7 KB/s at 100 players.) Tick cost is ~1.4 ms at 100: encoding now compares against baselines, and 6.7 removes the allocation overhead.

## Phase 6.7 — object pools, no per-tick garbage
`load:bots` now reports **garbage per tick** (heap growth around each `Match.step()`, summed) and how many ticks a collection ran in. Baseline before this step: **1,697 KB per tick at 100 players** (5.7 MB at 200), a scavenge every ~17 ticks.

What was allocating, found with V8's sampling heap profiler (`HeapProfiler.startSampling` with collected objects included) and fixed:
- Snapshot building: per-client entity objects, quantise objects, record lists, `Set`s and message objects → pooled entity objects, one reused message, an encoder that compares plain numbers, updates baselines in place and writes into shared scratch memory (only the output bytes are allocated).
- Interest selection: object candidates and a `Set` per viewer → insertion into preallocated typed arrays; counts returned instead of `array.length = 0` (which frees the backing store, so the next tick regrew it).
- Spatial grid: Map keys larger than 2³⁰ were boxed on the heap at every lookup → keys packed into small integers; `for…of` over `Set`s → arrays.
- Shots: a string-seeded generator, target list, pose objects, result objects, a closure and a `Set` per shot → one reseedable integer generator, pooled targets, caller-owned results, no closures; targets come from the grid instead of scanning every player.
- Lag history: two objects per player per tick and `Array.shift` → ring buffers in typed arrays.
- `rayAabb`/`rayCylinder`/`ColliderGrid`: temporary arrays and tuples removed.

| players | garbage KB/tick | ticks with a GC (of 400) | tick mean |
|---|---|---|---|
| 100 | 1,697 → **235** | 43 → **12** | 1.43 → **0.65 ms** |
| 200 | 5,728 → **669** | 52 → **16** | 4.49 → **2.07 ms** |

What is left is mostly the harness's own input objects, one output buffer per client per tick, and short-lived iterators. Message decoding for inputs still allocates (a small array per input message), which is network-driven, not tick-driven.

## Phase 6.9 — tuning and the 60 / 100 / 200 report
### What the real-server runs showed
In-process the whole tick costs ~0.6 ms at 100 players, but on a real server the tick was ~6–12 ms: **every WebSocket send is a system call** (~20 µs each; 100 clients = ~2 ms, and shots and kills were each sent separately to everyone in range, doubling that). Two changes:
1. **Events ride with the snapshot.** Shots and kills are queued per client and sent in the same frame as that client's snapshot (`bundle`, protocol message 0x85): one send per client per tick. Tick p50 at 100 bots on the dense yard fell from 11.6 to 9.0 ms; on the city-sized map it is 5.9 ms.
2. **Interest tuned** from a sweep of range/cap settings (`near 60 m`, `mid 120 m`, `far 200 m`, at most 30 others): same behaviour on screen, ~20% less bandwidth and send work.

### Final numbers
Method: the game server running a match in a worker thread (`MATCH_WORKERS=1 MATCH_MAP=bench MATCH_DUMMIES=0`), driven by real WebSocket bots from the same laptop (so the bots' own CPU use competes with the server; a separate load machine would look better). Bots wander, 30% sprint, 10% hold fire. Tick time is `Match.step()` including all sends, read from `/metrics` after 10 s.

| players | tick p50 | p95 | p99 | KB/s per client | snapshots/s per client | client RTT p95 |
|---|---|---|---|---|---|---|
| 60 | 3.7 ms | 5.2 | 6.2 | 1.8 | 20 | 2.7 ms |
| **100** | **5.9 ms** | **7.8** | **9.1** | **2.2** | 20 | 4.8 ms |
| 200 | 10.5 ms | 12.0 | 16.3 | 3.4 | 20 | 8.7 ms |

- **Targets met at 100 players:** tick p99 9.1 ms (< 15 ms) and 2.2 KB/s per client (< 4 KB/s).
- **60 players:** comfortable.
- **200 players:** bandwidth is under target (3.4 KB/s), tick p95 is 12 ms but p99 is 16.3 ms, slightly over 15 ms. It is a stretch size; the next levers are a second thread per match for sending (not possible with Node sockets today), sending ≤ 30 Hz-equivalent updates less often to far clients, or two 100-player matches. With separate machines for bots the numbers will be better.

### Dense case (everyone in the 120 m sandbox yard)
All players within range of each other, with constant fighting: 100 bots ≈ 7.3 KB/s per client, tick p50 9.0 ms. The interest cap (30) is what keeps this bounded; the real city spreads players out.

### Before / after summary (100 bots, in-process)
| | baseline (6.3) | now |
|---|---|---|
| KB/s per client | 40.8 | 2.2 |
| tick mean | 1.15 ms | 0.5 ms |
| garbage per tick | 1.7 MB | ~0.2 MB |
