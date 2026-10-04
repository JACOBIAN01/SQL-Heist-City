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
