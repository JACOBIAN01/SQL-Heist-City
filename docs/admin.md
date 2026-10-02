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
12. **Hot reload** — after save, calls game server `POST /internal/reload` (shared secret); active challenges keep their original version.

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
GET/PUT /config/reward-map | /config/settings
GET/POST/PUT /pools     GET/POST/PUT/DELETE /users (admin)
GET  /analytics/questions   GET /audit
```

## Safety
- Reference/student SQL runs through the same sandbox as the game (imported library from `server/src/sql`).
- Save blocked unless the reference passes on ≥5 seeds (no error, ≤ row cap, ≥1 row unless `allow_empty`).
- Soft-delete by default; CSRF protection; login rate limit.

## Seed bootstrap
`npm run db:seed` creates the first admin from env (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) and imports the 150 seed questions through the same import path teachers use.
