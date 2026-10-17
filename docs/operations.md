# Operations (Phase 20)

How to run SQL Heist City in staging and production: backups, restore, logs, metrics, alerts, releases. What needs your accounts (cloud, domain, alert address) is listed in `docs/inputs-needed.md` #10; everything here works locally first.

## Backups and the restore drill (20.3)
PostgreSQL is the system of record (questions, accounts, classes, attempts, profiles). The game server's SQLite snapshot is rebuilt from it at start, so it needs no backup.

**What to ask of the managed PostgreSQL** (any provider): automatic daily backups kept at least 14 days, point-in-time recovery if offered, encryption at rest, a private network or allow-list (no public database), and `sslmode=require` in `DATABASE_URL`.

**Our own dump, as a second copy** (`server/src/tools/pgBackup.ts`):

```
DATABASE_URL=… npm run backup:pg -w @heist/server -- backup --out /backups --keep 14
DATABASE_URL=… npm run backup:pg -w @heist/server -- drill  --out /backups
```
`backup` writes `heist-<time>.dump` (compressed `pg_dump`) and keeps the newest 14. `drill` takes a backup, restores it into a scratch database next to the source, compares every table's row count with the source, drops the scratch database, and exits 1 on any difference. Passwords reach `pg_dump` and `pg_restore` through the environment, never the command line. Schedule `backup` nightly (cron or the host's scheduler) and copy the files off the machine; run `drill` after every migration batch and once a month.

**Restoring for real** (a bad deploy, deleted data, a lost database):
1. Stop the admin and game server (so nothing writes).
2. Make an empty database: `createdb heist_restored`.
3. `pg_restore --no-owner --exit-on-error --dbname heist_restored heist-<time>.dump`
4. Check it: `psql heist_restored -c 'select count(*) from questions'` and the same for `players`, `attempt_items`.
5. Point `DATABASE_URL` at it (or rename databases), start the admin first (it runs migrations), then the game server, then `POST /internal/reload` on the game server.
6. Tell teachers what time the data is from: anything after the backup is gone.

**Drill record**
| Date | Where | Result |
|---|---|---|
| 2026-10-17 | local PostgreSQL 18 (`npm run pg:dev`) | 11 tables restored, 0 mismatches. Tests also check a restore that does not match is reported |
| — | managed PostgreSQL | **not yet**: needs the production database (inputs-needed #10) |

## Staging (20.2)
Staging is the production stack on a small machine with test data only: `deploy/compose.staging.yaml` (the three images, PostgreSQL managed elsewhere) driven by `deploy/release.sh`, with settings in a `.env` made from `deploy/env.example` (a different set of secrets from production).

`.github/workflows/deploy-staging.yml` builds the three images on every merge to `main`, pushes them to GitHub's container registry tagged with the commit, and runs `release.sh <commit>` on the staging host over SSH. **It is switched off until you set** the repository variables `STAGING_HOST` and `STAGING_USER` and the secret `STAGING_SSH_KEY` (a key for a deploy-only user on that host). Prepare the host once: Docker with the compose plugin, a folder `heist/` holding `.env` and `release.sh`, and the registry login. This needs your cloud account (inputs-needed #10).

## Releases and rollback (20.7)
`deploy/release.sh`:
```
./release.sh <tag>      # pull, start, wait until every container is healthy; if not, go back to the last good tag
./release.sh rollback   # go back to the previous tag by hand
./release.sh status
```
It remembers the current and previous tag in `.release/`, and an optional `BACKUP_CMD` runs first (for example a `backup:pg` dump). "Healthy" means running with a passing health check; a container still starting when `WAIT_SECONDS` (default 120) is up counts as failed.

**Checklist for a release**: `npm run ci` green on the commit · nightly fuzz green · the migration list reviewed (migrations only add; a rollback does not undo them, so the previous images must run on the new schema) · a fresh backup and a drill within the month · release to staging, play a round with bots (`npm run load:bots -- --mode socket`), then production · watch tick p99 and errors for 15 minutes.

**Rehearsed** (2026-10-17, on one machine with `deploy/compose.rehearsal.yaml`, production mode): v1 released healthy; v2 with a game server that never becomes healthy was refused and the stack went back to v1 by itself with the lobby answering; the manual `rollback` command worked. The rehearsal also caught a flaw in the first version of the script (it trusted `docker compose up --wait`, which returned success while a container was still starting), now fixed. A rehearsal on the real staging host is still to do once it exists.

**Rehearsing again**: build the images, tag them `heist-local/{server,admin,client}:v1`, copy the `deploy/` files and a `.env` (`IMAGE_PREFIX=heist-local`, a local `DATABASE_URL`, three random secrets) to a folder, then `COMPOSE_EXTRA='-f compose.rehearsal.yaml' SKIP_PULL=1 ./release.sh v1`.

## Logs, metrics, dashboards and alerts (20.4)
**Logs.** Both services write one JSON object per line (`server/src/log.ts`): `time`, `level`, `service` (`game` or `admin`), `msg`, plus fields. `LOG_LEVEL` (debug, info, warn, error; default info) sets the floor. Keys that look like secrets (`secret`, `password`, `token`, `ticket`, `cookie`, `authorization`, `api_key`) and `reference_sql` are replaced with `[redacted]` before writing; errors are written as name, message and a short stack; a crash (uncaught exception, unhandled rejection) is logged before the process exits. Point the host's log collector (the provider's, Loki, or `docker logs`) at stdout and search by field, for example `msg="anomaly"` grouped by `player`.

**Metrics.** `GET /metrics` (JSON) and `GET /metrics/prometheus` (Prometheus text) on the game server: players, tick time p50/p95/p99/max per match (open play and each class room), bytes per player, anomalies by kind, grader queue, busy processes, wait times, timeouts, memory. In production (`NODE_ENV=production`) they need the internal secret (`x-internal-secret` or `Authorization: Bearer …`); `/health` stays open for load balancers.

**Dashboards and alerts.** `docker compose --profile monitoring up -d` adds Prometheus (:9090) and Grafana (:3000, dashboard "SQL Heist City", eight panels) using `deploy/monitoring/`. Rules in `alerts.yml`:

| Alert | When | Severity |
|---|---|---|
| GameServerDown | the game server cannot be scraped for 1 min | critical |
| TickTooSlow | tick p99 over 15 ms for 2 min, per match | critical |
| GraderBacklog | more than 20 jobs waiting, or wait p95 over 2 s, for 2 min | warning |
| GraderTimeouts | over 50 time-limit stops in 10 min | warning |
| CheatAnomalies | over 100 anomalies in 10 min in one match | warning |
| MemoryHigh | over 1.5 GB for 5 min | warning |

Each carries an `action` note saying where to look. Send them to your address with Alertmanager (a receiver for email or chat; inputs-needed #10). **Tested**: `promtool test rules deploy/monitoring/alerts.test.yml` proves each alert fires on bad data and stays quiet on good; and on the live compose stack stopping the game server made `GameServerDown` fire about 70 seconds later. A test checks every metric the rules and the dashboard use exists in the server's output.

## Client error reporting (20.5)
Every page the game opens (menu, game, practice, assessment) installs an `ErrorReporter` (`client/src/errors/ErrorReporter.ts`, from `entry.ts`) that listens for uncaught errors and unhandled promise rejections and sends each to `POST /client-error` on the game server. A report is the message, a short stack, the page path and the browser name; **never a name, account, ticket or query string** (URLs lose their `?…`, and `ticket=`/`token=`/`code=` values are replaced). The same error is sent once, at most 5 per page load, at least a second apart; failures to send are ignored.

The server accepts it only from the game's own pages (`GAME_ORIGINS`), checks it against a schema (messages up to 500 characters, 4 KB body), limits each address (`clientErrorsPerIp`, default burst 30 and 60 a minute), writes it as `msg="client error"` at warn level and counts it (`heist_client_errors`). Search the logs for `msg="client error"` and group by `message` to see what is breaking for students; compare the stack's line numbers with the build. Verified live: a report with the game page's origin answered 204 and appeared in the container's log; one from another origin got 403.

## TLS, the domain and the CDN (20.6)
**Shape.** Two public names, both served by one Caddy (`deploy/Caddyfile`), the only thing open to the internet (ports 80 and 443): `SITE` (say `heist.school.org`) for students and `ADMIN_SITE` (`admin.heist.school.org`) for teachers. Caddy gets and renews Let's Encrypt certificates by itself, redirects http to https and adds HSTS and the usual security headers. On `SITE` it routes `/ws/*`, `/at/*`, `/lobby`, `/class/*` and `/client-error` to the game server, `/auth/*` to the account service, and everything else to the game page; `/metrics` is not routed. On `ADMIN_SITE` everything goes to the admin.

**The browser side.** A page on https talks https and wss to its own host (`client/src/net/serverAddress.ts`), so nothing needs a port or a `?server=`. A match on a worker thread has a port of its own, which the proxy cannot expose, so the game server relays `wss://SITE/at/<port>/ws/game` to it (only ports of real matches; the origin and connection limits apply first and the student's address is passed on). Set `GAME_ORIGINS=https://SITE` and `TRUST_PROXY=1` (both are in `deploy/compose.staging.yaml`).

**Domain.** Point both names at the machine (A/AAAA records), open 80 and 443, set `SITE`, `ADMIN_SITE`, `ACME_EMAIL` in `.env`, add `https://SITE` (and the callback on `ADMIN_SITE`/`SITE` for `/auth/google/callback`) to the Google OAuth client.

**CDN.** The game page is static and its files under `/assets/` carry content hashes, so a CDN can hold them for good. In front of `SITE` (Cloudflare, CloudFront, Fastly…): cache `/assets/*` only (the origin already sends `Cache-Control: public, max-age=31536000, immutable`); do not cache anything else, in particular `/lobby`, `/class/*`, `/auth/*` and `/` (the page itself is `no-cache`, so a release shows at once); allow WebSockets; forward the `Origin` header; and put the CDN's address ranges in `TRUSTED_PROXIES` so the students' own addresses reach the limits. The admin name should skip the CDN or be protected by it. `?server=https://game.example.org` lets a page served from elsewhere (a school's own host) point at the game.

**Verified locally** with `docker compose --profile tls up -d` (Caddy's own certificates, `https://localhost:8443`): the page loads over https with the security headers; the lobby answers; 20 bots joined over wss through the relay to a worker match; a port that is not a match, a path other than the game sockets, and another origin are refused; `/metrics` is not reachable; the admin site answers on its own name. **Not yet possible without you**: a public domain, certificates for it, and the CDN account (inputs-needed #10), so "the game loads over HTTPS from the CDN" is open.

