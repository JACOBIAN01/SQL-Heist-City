# Testing

| Level | Tool | What |
|---|---|---|
| Unit | Vitest | codec, RNG/variants, comparator, sandbox rules, reward strategies, selector, config merge |
| Contract | Vitest | every `RewardStrategy`/`DataGenerator`/`Weapon` implementation passes the same suite (Liskov) |
| Integration | Vitest + in-process server | challenge flow, admin→reload→server, WS join/input/snapshot |
| UI | Playwright | SQL pop-up flow vs mock server; admin question edit |
| Load | `load:bots` | 60/100/200 bots; tick ms, bytes/s, grader queue |
| Perf | scripted fly-through | fps, draw calls, triangles, first-load size |
| Question QA | `questions:validate` | each reference × 20 seeds |

## Must-have security tests (Phase 1)
Blocks `DROP`, `ATTACH`, `PRAGMA`, multi-statement, `load_extension`; kills infinite recursive CTE; row cap enforced; reference never serialised to client payloads.

## Rules
- Tests in the same commit as the code. Fakes via DI (`FakeClock`, `FakeRng`, `InMemoryQuestionRepository`, `FakeTransport`).
- Deterministic: all randomness through seeded `Rng`.
- CI runs lint, typecheck, unit, integration; load/perf on demand and per release.
