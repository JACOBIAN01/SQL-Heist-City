# API & Protocol

Types live in `shared/` (zod schemas + TS types); client, server, and admin import from there only.

## WebSocket (game)
Binary frames for high-rate data, JSON frames (`{t, ...}`) for rare messages. First byte = message type.

### Client → Server
| Type | Rate | Payload |
|---|---|---|
| `join` | once | name, matchId?, version |
| `input` | 30–60 Hz batched | seq, move axes, yaw, pitch, buttons bitmask (fire, jump, crouch, sprint, interact) |
| `switch_weapon`, `reload` | event | slot |
| `challenge_request` | ≤1/3 s | ref, rewardKey (e.g. `heal:small`, `vault:bank-3:lock-1`), target? |
| `challenge_run` | ≤1/1.5 s | ref, challengeId, sql (≤5000 chars) |
| `challenge_submit` | ≤1/2 s | ref, challengeId, sql |
| `challenge_hint` | event | ref, challengeId *(added in 4.6)* |
| `challenge_abandon` | event | ref |
| `ping` | 1 Hz | t |

### Server → Client
| Type | Rate | Payload |
|---|---|---|
| `welcome` | once | playerId, matchSeed, config subset, map seed |
| `snapshot` | 5–20 Hz | tick, ackSeq, quantised entities (id, x,y,z, yaw, state bits, hp bucket) — delta vs last ack |
| `event` | event | shot, hit, kill, loot, bank, lock_opened, alarm |
| `challenge` | reply | ref, now, result: `IssueResult` (challenge: id, rewardKey, tier, title, story, schemaSql, tables[name, columns, sampleRows, rowCount], hintCount, expiresAt) or a refusal reason |
| `challenge_preview` | reply | ref, now, result: `RunResult` (columns, rows ≤5, truncated) or SQL error feedback / refusal |
| `challenge_result` | reply | ref, now, result: `SubmitResult` (`correct` / `wrong` + feedback + lockedUntil / `locked` / `rejected`) |
| `challenge_abandoned` | reply | ref, now |
| `challenge_error` | reply | ref?, now, code `bad_message`, message |
| `scoreboard` | 1 Hz | top N banked |
| `vault_progress` | on change | bankId, locksOpen/total |
| `pong` | — | t |

Challenge replies echo the request's `ref` and carry the server clock `now` (epoch ms); all lockout/expiry times (`lockedUntil`, `retryAt`, `expiresAt`) are server time. Challenge messages are JSON text frames (≤16 kB). For the Phase 4 demo they travel on `ws://<host>:8080/ws/challenge` (player id assigned by the server per connection); Phase 5 moves them onto the game connection.

Never sent: reference SQL, other players' challenge content.

### Quantisation
Position 16-bit per axis relative to chunk origin (≈1.5 cm precision), yaw/pitch 8-bit, hp 4-bit bucket.

## Admin REST (JSON, cookie auth)

All routes below are under the `/api` prefix (e.g. `POST /api/auth/login`), so they never clash with the React UI's page routes. Mutating requests must send the header `x-heist-admin: 1` (CSRF guard; browsers can't add custom headers to cross-site form posts).

| Method | Route | Role | Notes |
|---|---|---|---|
| POST | /auth/login, /auth/logout | — | rate limited |
| GET | /auth/me | any | |
| GET/POST | /questions | teacher+ | filters: tier, topic, enabled, q |
| GET/PUT/DELETE | /questions/:id | teacher+ (delete: admin) | PUT creates a version |
| POST | /questions/:id/duplicate · enable · disable | teacher+ | |
| GET | /questions/:id/versions | teacher+ | |
| POST | /questions/:id/rollback/:v | teacher+ | |
| POST | /questions/:id/preview | teacher+ | `{seeds[], studentSql?}` |
| POST | /questions/import?dryRun= | teacher+ | JSON or CSV |
| GET | /questions/export?format= | teacher+ | |
| GET/PUT | /config/reward-map, /config/settings | admin (settings), teacher (pools) | zod validated |
| GET/POST/PUT | /pools | teacher+ | |
| GET/POST/PUT/DELETE | /users | admin | |
| GET | /analytics/questions | teacher+ | |
| GET | /audit | admin | |

Errors: `{error: {code, message, details?}}`, standard HTTP codes.

## Internal
`POST /internal/reload` (game server) — header `X-Internal-Secret`; admin calls after commits.

## Versioning
`welcome` carries protocol version; mismatch → client prompted to refresh.
