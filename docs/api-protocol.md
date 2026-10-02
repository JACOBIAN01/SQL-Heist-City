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
| `challenge_request` | ≤1/3 s | rewardType, target |
| `challenge_run` | ≤1/1.5 s | challengeId, sql |
| `challenge_submit` | ≤1/2 s | challengeId, sql |
| `challenge_hint` | event | challengeId, hintIdx |
| `challenge_abandon` | event | challengeId |
| `ping` | 1 Hz | t |

### Server → Client
| Type | Rate | Payload |
|---|---|---|
| `welcome` | once | playerId, matchSeed, config subset, map seed |
| `snapshot` | 5–20 Hz | tick, ackSeq, quantised entities (id, x,y,z, yaw, state bits, hp bucket) — delta vs last ack |
| `event` | event | shot, hit, kill, loot, bank, lock_opened, alarm |
| `challenge` | event | challengeId, rewardType, tier, title, story, schemaDescription, sampleRows, expiresAt, hints count |
| `challenge_preview` | event | columns, rows (≤5) or error |
| `challenge_result` | event | ok, lockoutUntil?, feedback?, reward? |
| `scoreboard` | 1 Hz | top N banked |
| `vault_progress` | on change | bankId, locksOpen/total |
| `pong` | — | t |

Never sent: reference SQL, other players' challenge content.

### Quantisation
Position 16-bit per axis relative to chunk origin (≈1.5 cm precision), yaw/pitch 8-bit, hp 4-bit bucket.

## Admin REST (JSON, cookie auth)
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
