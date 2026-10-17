# Identity and storage (Phase 13)

Decision record. It fixes who is playing (Google sign-in) and where records live (PostgreSQL). Owner decisions: identity is Google OpenID Connect; PostgreSQL is the system of record; the SQL sandboxes stay in-memory SQLite.

## Sign-in: Google OpenID Connect, server-side

**Flow (authorization code with PKCE and `state`/`nonce`)**
1. The game page sends the browser to `GET /auth/google/login?return=<game url>` on the **account service** (the admin server, port 8081 in development).
2. The service makes a random `state`, `nonce` and PKCE verifier, keeps them in a short-lived signed cookie, and redirects to Google.
3. Google sends the browser back to `/auth/google/callback?code=…&state=…`. The service checks `state`, exchanges the code (with the verifier and the client secret, server to server), and verifies the **ID token**: signature against Google's published keys (JWKS), `iss`, `aud` = our client ID, `exp`, `nonce`, and `email_verified`.
4. It finds or creates the **player** by Google's stable subject id (`sub`) and sets a **session cookie** (random token, only its hash stored; `HttpOnly`, `SameSite=Lax`, `Secure` in production). It redirects to `return`, which must be on the allow-list of game origins. No token ever travels in a URL.
5. The game page calls `POST /auth/ticket` (with the cookie, CORS limited to the game origin) and receives a **game ticket**.

**Game ticket.** A compact signed token: player id, display name, expiry (60 s), a random id, signed with HMAC-SHA256 using `TICKET_SECRET`, which the account service and every game server share. The game socket's first message carries it; the game server verifies it locally (no database call on the hot path), refuses expired or reused ones, and takes the player's name from it. `?name=` is gone. A ticket is for one connection; reconnecting asks for a new one.

**School domains.** `ALLOWED_EMAIL_DOMAINS` (comma separated) optionally restricts sign-in; empty means any verified Google account.

**Staff.** Admins and teachers keep email and password for now. Linking a teacher's Google account to their staff user is planned with the classroom work (Phase 14); until then players and staff are separate tables.

**Development.** Real Google needs a client ID and secret (`docs/inputs-needed.md`). Tests use a fake Google (a local OIDC server signing with a test key). A dev-only bypass (`DEV_LOGIN=1`, refused when `NODE_ENV=production`) lets bots, tests and `?at=` debugging play without Google.

### Options weighed
| Option | Verdict |
|---|---|
| **Own Google OIDC (chosen)** | One provider schools already use; no passwords to store; tokens verified with the `jose` library; no per-user fee |
| Auth0 / Clerk / Firebase Auth | Faster to start, but a per-user cost at class scale, another vendor holding student identities, and the same Google button underneath |
| Email and password for players | Passwords for minors to store and reset; rejected |
| Anonymous names (today) | No records that last, impersonation, no teacher link; rejected |
| Passport.js | Wraps what `jose` plus ~100 lines already do, and hides the checks that matter |

## Storage: PostgreSQL

| Need | Why PostgreSQL |
|---|---|
| Many writers: admin edits, game servers writing attempts, several classes at once | Row-level locking and real concurrency; SQLite has one writer |
| Learning analytics: aggregate millions of attempts | Indexes, `GROUP BY`, partial and expression indexes, `JSONB`, window functions |
| Backups and restore drills (Phase 20) | Point-in-time recovery on every managed service |
| Teachers will run reports | Safe read replicas |

| Option | Verdict |
|---|---|
| **PostgreSQL (chosen)** | As above; managed everywhere |
| SQLite + replication | Single writer; analytics and many game servers would fight over it |
| MySQL/MariaDB | Would work; weaker `JSONB` and constraints, no advantage here |
| MongoDB | The data is relational (classes → students → attempts → questions) |

**What lives where**
- **PostgreSQL:** questions and versions, pools, settings, reward map, staff users and sessions, audit log; players and their sessions; classes, rosters, attempts and profiles (later phases).
- **In-memory SQLite (unchanged):** the sandbox that runs and grades a student's query. It holds only generated practice tables and is thrown away.
- **Game server memory:** a read-only **content snapshot** (questions, settings) loaded from PostgreSQL at start and on every admin reload, so the 20 Hz loop never waits on a database. The game server writes nothing to PostgreSQL on the tick path; attempts are queued and written in batches (Phase 15.2).

**Schema changes** are ordered, append-only SQL migrations (`server/src/pg/migrations.ts`), applied by `npm run db:migrate` under an advisory lock. Development and tests use a private cluster that `scripts/pg-dev.mjs` starts in `data/pg` on port 54329; CI uses a service container (`TEST_DATABASE_URL`).

**Personal data kept about a player:** Google subject id, email, display name, school domain, created and last seen, and whether they said they are old enough (the verdict only, never the birth year). Nothing else (no photo, no birthday, no contacts). Every field, why, and how long: `docs/privacy.md`.

## Phase 13 plan, in order
13.2 PostgreSQL and migrations · 13.3 content and admin repositories on PostgreSQL (one-shot import from `dev.db`) · 13.4 players · 13.5 Google sign-in · 13.6 game tickets · 13.7 menu and sign-in screen · 13.8 display names · 13.9 dev bypass · 13.10 account deletion and export.
