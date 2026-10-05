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
| snapshot | 0x82 | tick u32, ackSeq u16, self (x y z f32, vx vy vz i16 in mm/s, flags u8, hp u8, weapon u8 (0 none, else 1 + index in `WEAPON_IDS`), ammo u8, vehicle u16 (the car you drive, 0 on foot)), changed count u8, removed count u8, then per changed entity: id u16, change mask u8 (1 pos delta, 2 pos absolute, 4 yaw, 8 pitch, 16 flags, 32 hp) + only the fields in the mask — pos delta = 3 × i8, absolute = 3 × i16, both in 2 cm units; yaw u8 (1.4°), pitch i8 (1.2°), flags u8, hp u8 — then the removed ids u16, then cars: changed count u8, removed count u8, per changed car 14 B (id u16, look u8 = kind index × 16 + variant, x z i16 in 2 cm, yaw u16, steer i8 in 0.01 rad, speed i16 in cm/s, driver u16), then the removed car ids u16 |
| event | 0x83 | sub-type u8 (1 shot, 2 kill, 3 joined, 4 left) + fields |
| pong | 0x84 | clientTime f64, tick u32 |
| bundle | 0x85 | count u8, then per part length u16 + a complete message (usually a snapshot followed by that tick's shot/kill events) |

Buttons: jump 1, crouch 2, sprint 4, fire 8. Flags: crouching 1, onGround 2, alive 4, firing 8. Other players are sent as changes against what *that client* already has (reliable ordered delivery, so no acks): a standing player costs nothing, a walking one ~7 bytes. A new player in range arrives as a full record; `removed` lists players who left the client's area of interest. Positions are int16 × 2 cm (world ≤ ±650 m); both sides keep the quantised values as the baseline. Protocol version 4.

Cars (protocol 4) have their own baseline: a car is sent in full whenever anything about it changed for that client (in range = within `interest.farRange`, plus your own car always), so a parked car costs 14 B once and a moving one 14 B a tick. The server snaps every car to wire precision after each tick (`quantiseVehicleState`), so the state a driver rewinds to is exactly the server's.

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
| GET/PUT | /config/reward-map, /config/settings, /config/combat | admin (settings), teacher (pools) | zod validated |
| GET/POST/PUT | /pools | teacher+ | |
| GET/POST/PUT/DELETE | /users | admin | |
| GET | /analytics/questions | teacher+ | |
| GET | /audit | admin | |

Errors: `{error: {code, message, details?}}`, standard HTTP codes.

## Internal
`POST /internal/reload` (game server) — header `X-Internal-Secret`; admin calls after commits.

## Versioning
`welcome` carries protocol version; mismatch → client prompted to refresh.


## JSON messages on the game socket (protocol 3, Phase 7)
Low-rate messages travel as `json` frames inside the binary protocol: client `0x04` and server `0x86`, followed by UTF-8 JSON (at most 24 KB). They may sit in a bundle. Binary input/snapshot frames are unchanged, and any other binary message still has to match its exact layout.

Client → server: the challenge messages (`challenge_request`, `challenge_run`, `challenge_submit`, `challenge_hint`, `challenge_abandon`; see above) and
- `interact { ref, anchor }`: use the map anchor with this id (lift, vault console, safehouse).

Server → client: the challenge replies and
- `interact_result { ref, anchor, result }` where `result` is `{action:'moved', storey}`, `{action:'open_task', rewardKey, target}` or `{action:'denied', reason}` (`unknown_anchor`, `too_far`, `dead`, `cooldown`, `not_available`).

The server validates every use: the anchor exists, the player is alive and within its radius (+0.75 m slack) on the same storey, and a 0.75 s per-player cooldown has passed. Anything that fails the shape check is ignored.

- `vaults { vaults: [{id, tier, locks, opened}] }` (server → client): progress of every vault, sent on join and whenever a lock opens. The vault door stops blocking once `opened == locks`; the client swaps its collision map and hides the door.
- `notice { text }` (server → client): a short message for the player, e.g. "Someone opened that lock first."

### Tasks on the game connection
The SQL pop-up uses the same challenge messages as before, now over `json` frames. The game checks every `challenge_request` against its own rules *before* the question system sees it (`TaskRule`, one per reward family). For a vault lock the player must be alive, standing at that vault's console (same storey, within reach), and the reward key must be exactly the vault's next lock (`vault:bank-<tier>:lock-<k>`); otherwise the reply is `{ok:false, reason:'not_allowed'}`. A reward key no rule owns is `unknown_reward`; without a question database it is `unavailable`. A correct `challenge_result` applies the reward (for a lock: opens it, swaps the collision map, broadcasts `vaults`). Each join gets a unique player key (`p<n>`) for the challenge system, so a reused player id never inherits another student's attempts or rate limits.
- `loot { add: [{id,x,y,z,amount}], remove: [id] }` (server → client): cash bags that appeared or vanished (vault spills, deaths and disconnects, pickups). A joining player gets every bag in `add`.
- `purse { carried, banked, speed }` (server → client, to that player): their cash; `speed` is the top-speed multiplier the server applies (the client predicts with it). Snapshot flag `Carrying` (32) marks players with cash so others draw a bag on their back.
- `banking { status: 'started', seconds }` / `{ status: 'done', amount }` / `{ status: 'cancelled', reason: 'hurt'|'moved'|'died' }` (server → client): banking is a channel the server counts down (`bankingSeconds`, default 4). `interact` on a safehouse answers `{action:'banking', seconds}` (or `denied` with `nothing_to_bank`).
- `equip { weapon }` (client → server): hold a gun you own (the number keys 1–5).
- `vehicle { ref, action: 'enter', vehicle }` / `{ ref, action: 'exit' }` (client → server): get into an empty car (within `enterRange` of its body) or out of yours (at most `exitMaxSpeed`; you step out by the driver's door, else the other door, behind or in front, whichever is free of walls and cars). Answer: `vehicle_result { ref, ok, reason? }` with `reason` one of `unknown_vehicle`, `too_far`, `taken`, `dead`, `already_driving`, `not_driving`, `too_fast`, `no_room`. While driving, `input` commands drive the car (moveY throttle/brake, moveX steering, jump = handbrake), Fire is ignored and anchors answer `denied`.
- `weapons { weapons: { [id]: WeaponSpec } }` (server → client): every gun's numbers (damage, rpm, range, magazine, pellets, spread, falloff, move spread, aim spread, zoom, recoil); sent on join and to everyone when an admin's change takes effect at a new round. The client paces fire, zooms and kicks the view with these, never with its own defaults.
- `feed { item }` (server → everyone): one line of heist news. `item.kind` is `alarm {bank, tier, lock, locks}`, `vault_open {bank, tier}`, `banked {id, name, amount}`, `wanted {id, name, cash, reward}` or `bounty_claimed {killerId, killer, victimId, victim, reward}`. Ids let the client say "you"; names are for display.
- `tutorial { step }` (server → client, tutorial rooms only): the step the player is on, an index into `TUTORIAL_STEPS` (equal to its length when all are done). Sent on join and whenever it changes. The tutorial is `ws://<host>:<port>/ws/tutorial` on the main server (the lobby port): the same protocol as the game socket, but every connection gets its own private match on map `tutorial`; when every room is busy the socket closes with 4001.
- `bounties { wanted: [{id, name, x, z, cash}], reward }` (server → everyone): who is wanted and where, every `bountyEverySec` while anyone is (once empty when the last one goes), and to a player who joins.
- Input button `Aim` (16, right mouse): aiming down the sights. The server multiplies the shot's spread by the gun's `aimSpread`; the client zooms the view.
- `arms { owned: [id], current }` (server → client): the guns owned this life and the one in hand; sent on join, unlock, equip and respawn. Rounds in the magazine travel in every snapshot (`self.ammo`) because they change with every shot.
- `round { phase: 'playing', endsInSec }` / `{ phase: 'ended', nextInSec, winner, standings }` (server → client): the round clock (the client counts down locally) and the final standings (top 10, `winner` is null if nobody banked) and `awards: [{id, playerId, name, value}]` (only awards somebody earned; ids and wording in `shared/src/config/awards.ts`). Sent on join, when overtime starts, at the end and at the start of the next round.
- `scores { top: [{id,name,banked,kills}], players }` (broadcast every `scoreboardEverySec`) and `standing { rank, players }` (per player, only when their rank or the player count changed).
- Joining after the join window of a round closes the socket with code 4003 ("This round is under way"); between rounds joining is open. The sandbox map has no rounds.
