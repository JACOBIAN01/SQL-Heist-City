# Release checklist (Phase 25.1)

Every line needs **evidence**: a test, a report, a screenshot, or a link. "Evidence" below names what exists today; **⬜ = not yet evidenced**, ⛔ = waits for the owner. The walk (25.2) updates this table in the release commit.

| Area | Item | Evidence |
|---|---|---|
| Identity | Google sign-in, school domains, tickets, sessions | admin/src/players/playerAuth.test.ts; browser test (menu.spec) |
| Identity | Real Google sign-in against the production OAuth client | ⛔ #1 (OAuth client) |
| Classroom | Create class, code, consent, release questions, start/end round, kick, lock | classRoutes tests; e2e/classroom.spec.ts |
| Classroom | A class of 100 and two classes at once | ClassRooms tests; nightly multiplayer test |
| Analytics | Mastery, results, briefs, exports | analytics tests; docs/admin.md |
| Teaching loop | Pre/post tests, practice mode, hints, review | Phase 16 tests |
| Content | 268 questions pass the QA gate across 100 seeds | `npm run questions:validate` in CI |
| Security | Sandbox escapes, fuzz, rate limits, origin policy, secrets scan | fuzz nightly; rateLimits tests; scripts/check-secrets.mjs |
| Security | External penetration test, high findings fixed | ⛔ #14 (brief ready: docs/pentest-brief.md) |
| Scale | 100 players tick p95 < 15 ms | tickBudget.test.ts |
| Scale | 100/200 on real cloud machines | ⛔ #15 |
| Ops | Backups and a restore drill, health-checked rollback, alerts tested | docs/operations.md; promtool tests; pgBackup tests |
| Ops | Staging and production environments live | ⛔ #10 |
| Privacy | Data map, retention, export/erase, log scan | dataMap.test.ts; PrivacyRetention tests; scripts/scan-logs.mjs |
| Privacy | Policy, terms, DPA reviewed by a lawyer; `reviewed: true` | ⛔ #11 |
| Rating | IARC rating obtained and age gate in place | age gate: MainMenu tests; rating ⛔ #12 |
| Accessibility | Remapping, text size, palettes, reduced motion, captions, axe checks | Phase 22 tests |
| Accessibility | Tried on a real gamepad, touch screen and low-end Chromebooks | ⛔ #9 |
| Language | Hindi reviewed by a native speaker; remaining screens converted | ⛔ #8 |
| Tests | `npm run ci` green, browser tests green, nightly green 3 nights | CI workflows |
| Tests | Playtests, usability sessions, bug bash: no S1/S2 open | ⛔ docs/review/playtests.md |
| Pilot | Pilot report and its critical fixes | ⛔ #13, docs/review/pilot-plan.md |
| Release | Release notes, version tag, rollback plan, on-call named | ⬜ with the production deploy |

## Go / no-go
Go only when no row above is ⬜ or ⛔ without a written decision by the owner to accept it. A row accepted without evidence is listed in the release notes.
