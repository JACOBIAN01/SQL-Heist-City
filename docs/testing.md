# Testing

How we know the game works, who looks at what, and when a build may go out. (Phase 23.1.)

## Levels

| Level | Tool | What | Runs |
|---|---|---|---|
| Unit | Vitest | codec, RNG/variants, comparator, sandbox rules, reward strategies, selector, config merge, settings, key bindings, palettes | every push (`npm test`) |
| Contract | Vitest | every `RewardStrategy`/`DataGenerator`/`Weapon`/store implementation passes the same suite (Liskov); the PostgreSQL stores pass the same suite as the in-memory ones | every push |
| Integration | Vitest + in-process server | challenge flow, admin→reload→server, WS join/input/snapshot, privacy export/erase | every push |
| Structural accessibility | Vitest + axe-core | SQL pop-up, menu, HUD, settings panel, touch controls | every push |
| Browser (e2e) | Playwright (`npm run e2e`) | the real game, admin and client on a fresh database: sign in, settings, tutorial heal, wrong answer, settings in a match | every merge (CI) |
| Question QA | `questions:validate` | each reference × 100 seeds | every push |
| Load | `load:bots` / `capacity` / `soak` | 60/100/200 bots; tick ms, bytes/s, garbage | nightly and per release |
| Fuzz | `fuzz:sql` | SQL sandbox | nightly (10 000 iterations) |
| Performance | scripted fly-through, `size` | fps, draw calls, triangles, first-load size | bundle size every push; the rest per release |
| Real devices | by hand, `docs/performance.md` | low-end Chromebooks, gamepad, touch screen | per release (needs devices, #9) |
| Playtest and usability | by hand (Phase 23.5–23.6) | fun, clarity, first-time-user flow | before the pilot |

## Who owns what
- **Code owner of the change** writes unit, contract and integration tests in the same commit.
- **Whoever changes a screen or a flow** updates the browser tests for it.
- **The owner (school contact)** runs the playtests and usability sessions; findings go in `docs/review/`.

## Entry and exit criteria
- **To merge:** `npm run ci` is green (secrets scan, format, lint, typecheck, tests, question QA, build, size budget) and the browser tests pass.
- **To release to staging:** nothing at severity S1 or S2 open; the nightly load and fuzz runs of the last 3 nights passed.
- **To release to a school:** the above, plus the release checklist (`docs/operations.md`), plus the legal items (`docs/inputs-needed.md` #11, #12) cleared by the owner.

## Bug severity
| Severity | Meaning | Example | Response |
|---|---|---|---|
| S1 critical | data loss or exposure, cheating that ruins matches, game unusable for a class | a student can read a reference solution; the server crashes at 60 players | stop the release; fix now |
| S2 high | a core flow is broken for many players, no workaround | cannot join a class; cash is not banked | fix before release |
| S3 medium | a flow is broken with a workaround, or wrong behaviour in a corner | a key cannot be remapped to a mouse button | fix in the next phase |
| S4 low | cosmetic, wording, rare | a caption overlaps another | when convenient |

## Triage
1. Anyone files it with: what happened, what was expected, steps, build, device and browser.
2. The owner sets the severity in the same day; S1 and S2 go to the top of the list.
3. A fix ships with a test that fails without it (or a note why that is not possible).
4. S1 and S2 are re-checked on the staging build before they are closed.

## Must-have security tests (Phase 1)
Blocks `DROP`, `ATTACH`, `PRAGMA`, multi-statement, `load_extension`; kills infinite recursive CTE; row cap enforced; reference never serialised to client payloads.

## Netcode tests (Phase 5)
- **Shared simulation:** `stepBody` is deterministic; walls, steps, jumps, crouch headroom and bounds are unit-tested.
- **Prediction:** `PredictedPlayer.test.ts` runs a client against a stand-in server (same step, 20 Hz ticks, 6-command budget, float32 snapshots) at 0/50/100/200 ms latency over a scripted walk/sprint/jump/crouch course and asserts corrections stay below 1 cm and the drawn position never jumps. Removing the replay step makes these tests fail.
- **Codec:** round-trips, truncation, lying counts, NaN, invalid UTF-8, and a 2000-frame fuzz that must only ever throw `CodecError`.
- **Combat:** hits, headshots, walls, range, fire rate in simulated time, input flooding, spawn protection, death and respawn; lag compensation including the cap and the respawn-history case (mutation-checked).
- **Sockets:** real `ws` clients against the real endpoint: join, snapshots, ping/pong, garbage/text/early-input drops, and a full shoot-kill-respawn cycle.

## Browser tests (Phase 23.2)
`npm run e2e` starts `e2e/stack.mjs`: a fresh SQLite file in `data/e2e/` seeded with the real questions, the game server, the admin service and the client, on the usual ports (stop your own dev servers first). Specs live in `e2e/*.spec.ts`. Headless Chromium uses SwiftShader, so these check behaviour, not frame rate. The tests found a real bug on their first run (the settings panel sat under the menu).

## Rules
- Tests in the same commit as the code. Fakes via DI (`FakeClock`, `FakeRng`, `InMemoryQuestionRepository`, `FakeTransport`).
- Deterministic: all randomness through seeded `Rng`.
- A test that is flaky is fixed or removed within the week, not retried forever.
