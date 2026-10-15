# Admin backend (Node)

Purpose: admins/teachers **create, change, and curate SQL questions and gameplay numbers** without code changes. The game server only reads what this service writes.

## Roles
| Role | Can |
|---|---|
| admin | everything: users, all questions, global settings, rollback, hard delete |
| teacher | create/edit/disable questions, preview, import/export, manage pools; cannot manage users or global settings |

## Stack
Express (REST API; serves the built React UI as static files), `node:sqlite` (shared DB file), zod (schemas from `shared/`), scrypt password hashing (node:crypto, no native deps), opaque session tokens stored hashed, httpOnly+sameSite=strict cookie. UI: React SPA (TypeScript + Vite; React Router, TanStack Query for data fetching), CodeMirror for SQL fields.

## Features
1. **Question CRUD** — title, story (markdown), tier 1–5, topics, schema SQL, data generator, variant params, reference SQL, compare flags, hints (text + cost), enabled.
2. **Versioning** — snapshot on every save; diff; rollback.
3. **Test & preview** — run reference on N seeds (default 20): rendered story, generated data, expected result, runtime; flags empty/degenerate/slow. "Try a student query" box.
4. **Import / export** — JSON (full) and CSV (simple); dry-run validation report; slug-based duplicate detection.
5. **Bulk actions** — enable/disable, change tier, tag.
6. **Reward mapping** — which tiers/pools back each reward (`heal:*`, `gun:*`, `ammo:*`, `vault:lockN`).
7. **Gameplay settings** — lockout, hint cost, heal amounts, loot values, round length, max players, spawn protection, weapon stats.
8. **Pools** — named question sets (e.g. "Week 3: JOINs") assignable to rooms/matches (classroom mode).
9. **Audit log** — who changed what, when.
10. **Analytics** — solve rate, median time, wrong-answer rate per question. *(Deferred: needs the game to record attempts — Phase 7+.)*
11. **Light / dark theme** — one icon toggle (top bar and login page); follows the OS until clicked, then remembered per browser. SQL/JSON editor colours follow the theme.
12. **Briefs to mark** (Phase 17.11) — the queue of open briefs handed in from the game, from the teacher's own classes (admins: all). Each shows the student's write-up, queries and the rubric; the teacher scores each criterion (0 to its marks) and adds optional feedback; **Save and next** moves to the next one. The first mark adds the brief to the student's profile as one Build item (its weight available, weight × share of the rubric earned); a re-mark moves only the earned marks. `GET /api/briefs?status=&classId=`, `GET /api/briefs/:id`, `POST /api/briefs/:id/mark {marks[], feedback?}`; every mark is audited.
13. **Hot reload** — after save, calls game server `POST /internal/reload` (shared secret); active challenges keep their original version.

## Patterns used (why / how)
| Pattern | Why |
|---|---|
| Repository (`QuestionRepository`, `SettingsRepository`, `UserRepository`) | route handlers don't know SQLite; testable with in-memory fakes |
| ISP: `QuestionWriter` (admin) vs `QuestionReader` (game) | each service only gets the capability it needs |
| Command (`CreateQuestion`, `UpdateQuestion`, `Rollback`) + audit | every mutation is a named command → uniform validation, audit, versioning |
| Strategy (`ImportParser`: JSON, CSV) | add formats without touching import service |
| Facade (`QuestionAdminService`) | routes call one service for validate → save → version → audit → reload |
| Observer (`QuestionChanged` event) | reload notifier and audit subscribe independently |
| Dependency Injection via composition root | testable, no singletons |

## REST API (summary; full in api-protocol.md)
```
POST /auth/login | /auth/logout     GET /auth/me
GET/POST /questions    GET/PUT/DELETE /questions/:id
POST /questions/:id/duplicate | /enable | /disable
GET  /questions/:id/versions   POST /questions/:id/rollback/:v
POST /questions/:id/preview
POST /questions/import   GET /questions/export
GET/PUT /config/reward-map | /config/settings | /config/combat | /config/tutorial (the tutorial's fixed heal/gun/vault questions; each slug must exist) | /config/heist | /config/vehicles | /config/atmosphere | /config/city (12.4: a partial change merged field by field into the stored values, validated whole, audited)
GET/POST/PUT /pools     GET/POST/PUT/DELETE /users (admin)
GET  /analytics/questions   GET /audit
```

## Safety
- Reference/student SQL runs through the same sandbox as the game (imported library from `server/src/sql`).
- Save blocked unless the reference passes on ≥5 seeds (no error, ≤ row cap, ≥1 row unless `allow_empty`).
- Soft-delete by default; CSRF protection; login rate limit.

## Seed bootstrap
`npm run db:seed` creates the first admin from env (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) and imports the 150 seed questions through the same import path teachers use.

## Gameplay settings reach a running match (12.4)
The Settings page has a card for heist rules, vehicles, day and night, and the city, drawn from whatever numbers the server sends (a new setting appears with no UI change; only edited fields are sent).
- **Heist, vehicles, day and night:** every match re-reads them when a new round starts and tells its clients (`world` message), so the cars a client predicts with are the server's. The heist numbers are rewritten in place in the running match, including locks per vault and banking time.
- **City:** the generation settings travel in the map id (`city:autumn~blocks=6~banks=4`), so a client builds exactly the server's city. A city cannot change under a running match: a new one applies to matches created afterwards (a server restart for the single in-process match).
- **Tutorial** questions were already editable (Tutorial card).
