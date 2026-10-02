# Rules

## 1. Workflow rules (MUST)
1. **One phase at a time.** Phases are defined in `Phases.md`. Do not start the next phase until the user explicitly approves.
2. **End-of-phase ritual:** run tests/lint/typecheck, write a short summary (what was built, how to verify, known gaps), list the commits, then stop and wait.
3. **Multiple small, meaningful commits per phase.** Each commit = one logical change that builds and passes tests. Aim for 5–15 commits per phase. Forbidden: a single "phase done" mega-commit, "wip" commits, commits mixing unrelated changes.
4. **Commit message format:** `area: imperative summary` (e.g. `server/sql: block ATTACH in grader authorizer`). Body explains *why* when not obvious.
5. **Tests with code.** New logic ships with tests in the same commit.
6. **Docs stay true.** If a decision changes, update the relevant doc in the same phase.
7. **No scope creep.** Ideas outside the current phase go to `docs/backlog.md`.
8. **Ask before** destructive actions, adding heavy dependencies (>100 KB client-side), or changing a documented decision.

## 2. Product rules (MUST)
1. **Everything about questions is configurable** and stored in the DB: text, schema, data generator, reference solution, tier, topic, reward mapping, hints, hint cost, lockout seconds, enabled flag. Game code reads these; it never embeds them.
2. **A teacher/admin can** create, edit, disable, duplicate, import, export, and version questions, and change reward→tier mappings and gameplay numbers, without a deploy.
3. **Same reward ≠ same question.** Per-player, per-attempt seeds; pool rotation; no repeat until pool exhausted.
4. **Server-authoritative:** damage, health, cash, inventory, vault state, grading, cooldowns.
5. **Reference solutions never leave the server** (not in WS payloads, not in client bundles, not in logs at info level).
6. **The world never pauses** during a SQL pop-up.

## 3. Security rules
- SQL sandbox: SELECT/WITH only; parse + SQLite authorizer; `query_only`; 2 s timeout in a worker; 1000-row cap; no ATTACH/PRAGMA/extension loading.
- Rate-limit every WS message type and every REST route; cap message size.
- Admin: password hashing (argon2/scrypt), session cookies httpOnly+sameSite, role checks on every route (`admin`, `teacher`), audit log of question edits.
- Validate all inbound data with zod schemas from `shared/`.

## 4. Code rules
- TypeScript strict; ESM; no default exports except config files.
- Small modules, pure functions for game logic where possible (easier to test and to run in bots).
- No allocations in hot loops (tick, render); pool vectors/buffers.
- Client budgets: first load <8 MB, draw calls <200, triangles <400k on screen.
- Server budgets: tick <15 ms at 100 players; <4 KB/s/client average downstream.
- Dependencies: justify each; prefer zero-dep or tiny libs.

## 6. OOP, SOLID & design-pattern rules (MUST)
1. **Use OOP where the domain has identity/behaviour** (Player, Match, Bank, Vault, Weapon, Challenge, Grader). Use plain pure functions/data for stateless math (codec, RNG, comparators) — don't force classes.
2. **SOLID applied where needed**, not ritually:
   - **S**: one reason to change per class (e.g. `Grader` grades; it does not select questions).
   - **O**: extend by adding a class, not editing a switch (new reward type, new weapon, new data-generator kind).
   - **L**: subtypes honour the base contract (every `Weapon` is usable wherever `Weapon` is expected).
   - **I**: small role interfaces (`QuestionRepository` read vs. `QuestionWriter`; game server only gets the read one).
   - **D**: depend on interfaces; inject dependencies via constructors (DB, clock, RNG, grader) so tests use fakes.
3. **Design patterns only when they remove a real problem.** Planned ones are listed in `design-principles.md` (Strategy, Factory, Observer/EventBus, State, Command, Repository, Object Pool, Facade, Adapter, Decorator, Template Method, Builder). Adding a new one requires a line in that doc.
4. **Mandatory "why" comment:** every class/interface that applies a SOLID principle or pattern carries a short comment of the form
   `// Pattern: Strategy — Why: new reward types plug in without editing RewardService (Open/Closed).`
   The comment states the pattern/principle **and** the concrete benefit in this codebase. No comment = review fails.
5. **Docs explain why and how:** each major module's doc (`backend.md`, `frontend.md`, `admin.md`) has a "Patterns used" section; `design-principles.md` is the master index (pattern → where → why → how to extend).
6. **Composition over inheritance**; inheritance only for true is-a (and Template Method skeletons). Prefer `readonly` fields, small constructors, no god classes (>300 lines → split).
7. **Performance exception:** hot loops (tick, render, codec) may use data-oriented code (typed arrays, pools) — document it with `// Perf:` + reason.

## 7. Review checklist (every phase)
- [ ] Every new pattern/SOLID use has a `Why:` comment and is listed in design-principles.md
- [ ] Tests, lint, typecheck green
- [ ] Budgets still met (if applicable)
- [ ] No hard-coded question/reward content
- [ ] No solution leakage
- [ ] Docs updated
- [ ] Commits are small and meaningful
