# Deployment

## Environments
- **dev:** `npm run dev:*` (server :8080, admin :8081, client :5173); SQLite file `data/dev.db`.
- **prod:** static client on a CDN/static host; game server + admin as Node processes (Docker), shared persistent volume for the SQLite file; TLS termination at proxy (WSS).

## Config (env)
`PORT`, `DB_PATH`, `INTERNAL_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first run), `SESSION_SECRET`, `MAX_PLAYERS`, `LOG_LEVEL`.

`GAME_ORIGINS` (game server and admin): the comma-separated origins the game page is served from, e.g. `https://heist.school.org`. The game server refuses WebSocket upgrades and lobby/class-status reads whose `Origin` is not listed (or the server's own); in development any localhost page is allowed. Requests without an `Origin` (bots, load tests) are not browser pages and are let through.

## Sizing guide (to be measured in Phase 6/10)
- 100 players/match ≈ 1 core for match worker + grader pool cores; expect ~400 KB/s outbound per match.
- Scale out by running more game-server processes; lobby assigns matches.

## Operations
Health `/health`, metrics `/metrics`, nightly SQLite backup (admin question data is precious), structured logs.

## Release checklist
Tests green · budgets met · `questions:validate` green · migrations applied · backup taken.
