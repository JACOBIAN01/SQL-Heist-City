# Deployment

## Environments
- **dev:** `npm run dev:*` (server :8080, admin :8081, client :5173); SQLite file `data/dev.db`.
- **prod:** static client on a CDN/static host; game server + admin as Node processes (Docker), shared persistent volume for the SQLite file; TLS termination at proxy (WSS).

## Config (env)
`PORT`, `DB_PATH`, `INTERNAL_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first run), `SESSION_SECRET`, `MAX_PLAYERS`, `LOG_LEVEL`.

`GAME_ORIGINS` (game server and admin): the comma-separated origins the game page is served from, e.g. `https://heist.school.org`. The game server refuses WebSocket upgrades and lobby/class-status reads whose `Origin` is not listed (or the server's own); in development any localhost page is allowed. Requests without an `Origin` (bots, load tests) are not browser pages and are let through.

`RATE_LIMITS` (game server and admin, optional): JSON over the default limits, e.g. `{"connectionsPerIp":{"burst":600,"perMinute":2000}}` (docs/backend.md, "Rate limits"). `TRUST_PROXY=1`: count the first `X-Forwarded-For` address (only behind your own proxy).

## Sizing guide (to be measured in Phase 6/10)
- 100 players/match ≈ 1 core for match worker + grader pool cores; expect ~400 KB/s outbound per match.
- Scale out by running more game-server processes; lobby assigns matches.

## Operations
Health `/health`, metrics `/metrics`, nightly SQLite backup (admin question data is precious), structured logs.

## Release checklist
Tests green · budgets met · `questions:validate` green · migrations applied · backup taken.

## Secrets (Phase 18.5)
No secret lives in the repository. `scripts/check-secrets.mjs` runs first in `npm run ci` and fails on private keys, cloud and OAuth keys, tokens, database URLs with passwords, tracked `.env` files and random-looking values assigned to `*SECRET*`/`*PASSWORD*`/`*TOKEN*` names in code. CI also runs `npm audit --audit-level=high`: a known high or critical advisory blocks the merge.

Secrets come from the environment (or the host's secret store injecting it):

| Secret | Used by | Make it with |
|---|---|---|
| `TICKET_SECRET` | game server (required in production), admin (player sign-in) — the same value on both | `openssl rand -base64 32` |
| `INTERNAL_SECRET` | admin → game server calls — the same value on both | `openssl rand -base64 32` |
| `COOKIE_SECRET` | admin player-session cookies (defaults to `TICKET_SECRET`; set its own in production) | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_SECRET` | admin Google sign-in | Google Cloud console |
| `DATABASE_URL` | both (PostgreSQL, with its password) | your database host |
| `ADMIN_PASSWORD` | admin, first start only, to create the first admin | a password manager |

In production (`NODE_ENV=production`) both services refuse to start if a required secret is missing, if one is shorter than 32 characters or a development placeholder, or if two are the same. Rotate by setting the new value on both services and restarting them together; tickets last 60 s and admin sessions 12 h, so a rotation signs people out at most once.

## Sizing: classes per server (Phase 19.4)
Each class room is one match on its own thread; student SQL runs in a shared pool of sandbox processes (one per core minus one, plus two spares). Measured with `npm run capacity -w @heist/server -- --matches 1,2,4,7 --players 100` (matches ticking back to back on a laptop, so the CPU figures are an upper bound), and the socket test of 19.1 (sending adds about a third):

| | one 100-player class | why it matters |
|---|---|---|
| Game CPU | 20–50 ms per second (2–5% of a core; the higher figure when 7 busy matches share the CPU) | the tick must stay under 15 ms |
| Memory | ~70 MB per class room, plus ~45 MB per sandbox process and ~200 MB for the server itself | |
| Grading | a few ms per Run or Submit; runaways are capped by the two-lane scheduler (19.3) | needs its own cores |

Rule of thumb: half the cores for the game, half for grading; **4 classes of 100 per game core**. A 200-player class costs about three 100-player classes.

| Machine | Classes of 100 at once | Memory to give it |
|---|---|---|
| 2 vCPU, 2 GB | 4 | ~1 GB used |
| 4 vCPU, 4 GB | 8 | ~1.5 GB used |
| 8 vCPU, 8 GB | 16 | ~2.5 GB used |

Watch `/metrics` (tick p99, `anomalies`) and add a server before tick p99 passes 15 ms. These are laptop numbers; the cloud run of 19.1 should confirm them.

