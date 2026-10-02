# Design Principles: OOP, SOLID, Patterns

Rule: use them **where they solve a real problem here**; every use gets a `// Pattern: X — Why: …` comment in code. This file is the master index: *what, where, why, how to extend*.

## 1. Comment convention
```ts
// Pattern: Strategy — Why: each reward type (heal, gun, vault lock) is its own class,
// so adding "armor" later means adding a class, not editing RewardService (Open/Closed).
export interface RewardStrategy { apply(player: Player, ctx: RewardContext): void }
```
SOLID uses: `// SOLID: I (Interface Segregation) — Why: game server only needs read access to questions.`
Perf exceptions: `// Perf: pooled buffer — Why: avoids GC pauses inside the 50 ms tick.`

## 2. OOP map (what is a class)
| Domain object | Responsibility |
|---|---|
| `Match` | owns state, tick, phases |
| `Player` | hp, inventory, cash, current challenge |
| `Bank`, `Vault`, `Lock` | structure and lock progress |
| `Weapon` (+ subclasses/config) | fire rules |
| `Challenge` | one issued question instance (binding, expiry, lockout) |
| `Grader`, `Sandbox` | execute + compare SQL |
| `QuestionSelector`, `VariantBuilder` | choose and instantiate questions |
| `Connection`, `Session` | network lifecycle |

Plain functions: binary codec, RNG helpers, result comparator, math.

## 3. SOLID applied
| Principle | Concrete application |
|---|---|
| **S**ingle Responsibility | `QuestionSelector` picks, `VariantBuilder` builds, `Grader` grades, `FeedbackBuilder` writes hints — four classes, four reasons to change |
| **O**pen/Closed | New reward/weapon/data-generator kind = new class registered in a factory; no edits to existing switch statements |
| **L**iskov | Any `RewardStrategy`/`Weapon`/`DataGenerator` is substitutable; contract tests run against every implementation |
| **I**nterface Segregation | `QuestionReader` (game server) vs `QuestionWriter` (admin); `Clock`, `Rng`, `Logger` as tiny interfaces |
| **D**ependency Inversion | Services take interfaces via constructor (`Grader`, `QuestionReader`, `Clock`, `Rng`); wiring in one composition root per app; tests inject fakes |

## 4. Patterns (planned) — where, why, how
| Pattern | Where | Why it helps here | How to extend |
|---|---|---|---|
| **Strategy** | `RewardStrategy` (HealReward, WeaponReward, AmmoReward, VaultLockReward); `ComparePolicy` (ordered/unordered/case); param resolvers per `kind` (`server/src/variants/params.ts`) | Rewards and comparison rules change independently; teachers add behaviours through config, devs through one class | Add class, register in `RewardRegistry` |
| **Factory / Registry** | column-generator builders (`server/src/variants/dataGenerators.ts`: serial, pick, int, real, date, bool, text_pattern, fk, const), `WeaponFactory`, `RewardRegistry` | Build objects from DB/JSON specs (`{"kind":"pick"}`) without `switch` in callers; keeps questions data-driven | Register new `kind` |
| **Repository** | `QuestionRepository`, `SettingsRepository`, `UserRepository` (SQLite impls) | Game/admin logic is independent of SQLite; swap to Postgres or in-memory fakes for tests | New impl of interface |
| **Observer / Event Bus** | `MatchEventBus` (`PlayerKilled`, `LockOpened`, `CashBanked`, `ChallengeSolved`) | Scoreboard, killfeed, bounty markers, metrics subscribe without coupling to combat/vault code | Subscribe handler |
| **State** | `MatchPhase` (Lobby→Running→Ending→Results); `PlayerState` (Alive, Dead, InVehicle, SolvingChallenge); `ChallengeState` | Removes giant `if (state==…)` blocks; each state owns allowed actions | Add state class |
| **Command** | Client inputs → `InputCommand` queue (move, fire, interact); admin audit actions | Enables prediction/replay, validation, rate-limiting and logging uniformly | New command + handler |
| **Object Pool** | Snapshot buffers, vectors, projectiles, particles | No per-tick allocation → stable tick time at 100–200 players | Pool per type |
| **Facade** | `ChallengeService` (select→variant→grade→reward) | Match code calls one method; sandbox/worker complexity hidden | — |
| **Adapter** | `SqliteSandboxAdapter` over node:sqlite; `WsConnectionAdapter` over `ws` | Isolates third-party APIs; easy to mock or replace | New adapter |
| **Decorator** | `RateLimitedGrader`, `MetricsGrader` wrapping `Grader`; `withNulls` wrapping any column generator | Add cross-cutting behaviour without touching core grader | Wrap another decorator |
| **Template Method** | `BaseRewardStrategy.apply()` = validate → mutate → emit event; subclasses fill the mutate step | Guarantees every reward emits events and audit consistently | Subclass override hook |
| **Builder** | `VariantBuilder`, `SnapshotBuilder`, `ChunkBuilder` | Multi-step construction with optional parts stays readable | Add step |
| **Singleton (avoided)** | — | Use DI + composition root instead; singletons hide dependencies and break tests | n/a |

## 5. Anti-patterns to avoid
God classes (`GameManager`), anemic everything, premature abstraction (no interface with one impl unless a test fake needs it), deep inheritance, patterns without a "Why".

## 6. Review test
For each pattern in a PR ask: *what breaks or gets harder if I remove it?* If nothing, remove it.
