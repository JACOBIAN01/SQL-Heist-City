# Testing

| Level | Tool | What |
|---|---|---|
| Unit | Vitest | codec, RNG/variants, comparator, sandbox rules, reward strategies, selector, config merge |
| Contract | Vitest | every `RewardStrategy`/`DataGenerator`/`Weapon` implementation passes the same suite (Liskov) |
| Integration | Vitest + in-process server | challenge flow, admin→reload→server, WS join/input/snapshot |
| UI | Playwright | SQL pop-up flow vs mock server; admin question edit |
| Load | `load:bots` | 60/100/200 bots; tick ms, bytes/s, grader queue |
| Perf | scripted fly-through | fps, draw calls, triangles, first-load size |
| Question QA | `questions:validate` | each reference × 100 seeds |

## Must-have security tests (Phase 1)
Blocks `DROP`, `ATTACH`, `PRAGMA`, multi-statement, `load_extension`; kills infinite recursive CTE; row cap enforced; reference never serialised to client payloads.

## Netcode tests (Phase 5)
- **Shared simulation:** `stepBody` is deterministic; walls, steps, jumps, crouch headroom and bounds are unit-tested.
- **Prediction:** `PredictedPlayer.test.ts` runs a client against a stand-in server (same step, 20 Hz ticks, 6-command budget, float32 snapshots) at 0/50/100/200 ms latency over a scripted walk/sprint/jump/crouch course and asserts corrections stay below 1 cm and the drawn position never jumps. Removing the replay step makes these tests fail.
- **Codec:** round-trips, truncation, lying counts, NaN, invalid UTF-8, and a 2000-frame fuzz that must only ever throw `CodecError`.
- **Combat:** hits, headshots, walls, range, fire rate in simulated time, input flooding, spawn protection, death and respawn; lag compensation including the cap and the respawn-history case (mutation-checked).
- **Sockets:** real `ws` clients against the real endpoint: join, snapshots, ping/pong, garbage/text/early-input drops, and a full shoot-kill-respawn cycle.

## Rules
- Tests in the same commit as the code. Fakes via DI (`FakeClock`, `FakeRng`, `InMemoryQuestionRepository`, `FakeTransport`).
- Deterministic: all randomness through seeded `Rng`.
- CI runs lint, typecheck, unit, integration; load/perf on demand and per release.
