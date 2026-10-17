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

