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
| `challenge_hint` | event | ref, challengeId, index (hints are revealed in order; asking again for a revealed hint is free) |
| `challenge_abandon` | event | ref |
| `ping` | 1 Hz | t |

### Server → Client
| Type | Rate | Payload |
|---|---|---|
| `welcome` | once | playerId, matchSeed, config subset, map seed |
| `snapshot` | 5–20 Hz | tick, ackSeq, quantised entities (id, x,y,z, yaw, state bits, hp bucket) — delta vs last ack |
| `event` | event | shot, hit, kill, loot, bank, lock_opened, alarm |
| `challenge` | reply | ref, now, result: `IssueResult` (challenge: id, rewardKey, tier, title, story, schemaSql, tables[name, columns, sampleRows, rowCount], hintCosts[], hintCostMode, expiresAt) or a refusal reason |
| `challenge_preview` | reply | ref, now, result: `RunResult` (columns, rows ≤5, truncated) or SQL error feedback / refusal |
| `challenge_result` | reply | ref, now, result: `SubmitResult` (`correct` / `wrong` + feedback + lockedUntil / `locked` / `rejected`) |
| `challenge_hint` | reply | ref, now, result: `HintResult` (hint: index, text, cost, costMode, charged — the game deducts `cost` once when `charged`) |
| `challenge_abandoned` | reply | ref, now |
| `challenge_error` | reply | ref?, now, code `bad_message`, message |
| `scoreboard` | 1 Hz | top N banked |
| `vault_progress` | on change | bankId, locksOpen/total |
| `pong` | — | t |

Challenge replies echo the request's `ref` and carry the server clock `now` (epoch ms); all lockout/expiry times (`lockedUntil`, `retryAt`, `expiresAt`) are server time. Challenge messages are JSON text frames (≤16 kB). For the Phase 4 demo they travel on `ws://<host>:8080/ws/challenge` (player id assigned by the server per connection); They move onto the game connection in Phase 7, when rewards apply to game state (the game socket below carries only movement and combat until then).

Never sent: reference SQL, other players' challenge content.

### Binary layout (built in Phase 5; code in `shared/src/net/codec.ts`)
Little-endian. The first byte is the type. Decoders throw `CodecError` on truncated, oversized, non-finite or trailing data; servers drop the frame, never crash.

| Client → server | Type | Layout |
|---|---|---|
| join | 0x01 | protocol u8, name (len u8 + utf-8, ≤24 B) |
| input | 0x02 | count u8 (1–8), then per command 10 B: seq u16, moveX i8, moveY i8, yaw u16, pitch i16, buttons u8, viewLag u8 (×5 ms) |
| ping | 0x03 | clientTime f64 |

| Server → client | Type | Layout |
|---|---|---|
| welcome | 0x81 | playerId u16, tick u32, tickRate u8, mapId (string) |
| snapshot | 0x82 | tick u32, ackSeq u16, self (x y z f32, vx vy vz i16 in mm/s, flags u8, hp u8), changed count u8, removed count u8, then per changed entity: id u16, change mask u8 (1 pos delta, 2 pos absolute, 4 yaw, 8 pitch, 16 flags, 32 hp) + only the fields in the mask — pos delta = 3 × i8, absolute = 3 × i16, both in 2 cm units; yaw u8 (1.4°), pitch i8 (1.2°), flags u8, hp u8 — then the removed ids u16 |
| event | 0x83 | sub-type u8 (1 shot, 2 kill, 3 joined, 4 left) + fields |
| pong | 0x84 | clientTime f64, tick u32 |
| bundle | 0x85 | count u8, then per part length u16 + a complete message (usually a snapshot followed by that tick's shot/kill events) |

Buttons: jump 1, crouch 2, sprint 4, fire 8. Flags: crouching 1, onGround 2, alive 4, firing 8. Other players are sent as changes against what *that client* already has (reliable ordered delivery, so no acks): a standing player costs nothing, a walking one ~7 bytes. A new player in range arrives as a full record; `removed` lists players who left the client's area of interest. Positions are int16 × 2 cm (world ≤ ±650 m); both sides keep the quantised values as the baseline. Protocol version 2.

Both sides simulate with the *quantised* yaw/pitch (the client rounds before simulating), so the server replays exactly what the client predicted.

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
