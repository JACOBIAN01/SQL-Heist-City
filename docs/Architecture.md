# Architecture

## 1. Goals & constraints
- Browser game, no install, **<8 MB first load**, 60 fps on integrated GPUs.
- **100 players per match** (config 60–200). One match per worker thread/process.
- Server-authoritative; SQL grading only on the server.
- All question/reward content is data, edited via admin.
- "GTA feel, lightweight": third-person, streets, cars, guns, day/night, realistic art direction using cheap tricks — not GTA fidelity.

## 2. System diagram
```
 Student browser                                   Teacher browser
 ┌───────────────────────────┐                     ┌──────────────────┐
 │ Three.js client           │                     │ Admin web UI     │
 │  render / input / UI      │                     └────────┬─────────┘
 │  SQL pop-up (CodeMirror)  │                              │ REST (cookie auth)
 └─────────┬─────────────────┘                              ▼
           │ WebSocket (binary)                   ┌──────────────────┐
           ▼                                      │ Admin API        │
 ┌───────────────────────────┐   hot-reload       │ (Fastify, Node)  │
 │ Game server (Node)        │◄──signal───────────┤ CRUD, import,    │
 │  match loop 20 Hz         │                    │ preview, config  │
 │  AOI / snapshots          │                    └────────┬─────────┘
 │  challenge service        │   read                      │ write
 │   ├ selector              │◄────────┐                   ▼
 │   ├ variant generator     │         └──────────►  ┌──────────────┐
 │   └ grader (worker pool)  │                       │ SQLite file  │
 └───────────────────────────┘                       │ questions,   │
                                                     │ config, users│
                                                     └──────────────┘
```

## 3. Components
| Component | Responsibility | Doc |
|---|---|---|
| client | render, input, prediction, UI, SQL pop-up | frontend.md |
| server | tick loop, state, combat, AOI, challenges, grading | backend.md |
| admin | question + config management, users | admin.md |
| shared | protocol, zod schemas, default config, types | api-protocol.md |

## 4. Netcode
- Transport: WebSocket, binary frames (custom compact protocol), JSON only for rare/low-rate messages (challenge payloads).
- Tick 20 Hz authoritative; client sends input at 30–60 Hz batched per tick.
- Client prediction + server reconciliation for the local player; 100 ms interpolation buffer for remote entities.
- Hitscan with lag compensation (server rewinds target positions up to 200 ms).
- **AOI:** spatial hash grid (cell 64 m). Each client receives entities in its cell + neighbours; near (<60 m) at 20 Hz, mid (<150 m) at 10 Hz, far at 5 Hz. Hard cap ~30–40 entities/snapshot.
- Delta compression: quantised positions (16-bit), yaw/pitch bytes, bitmask for changed fields. Budget <4 KB/s/client.
- Scale levers: worker thread per match, buffer pools, no per-tick allocations.

## 5. SQL challenge flow
```
client                server                         db / worker
  │ request_challenge     │                               │
  │ (reward, target)  ──► │ pick question (tier, pool,    │
  │                       │ player history) + seed ──────►│ load template
  │                       │ build variant (schema+data)   │
  │ ◄── challenge{story,  │                               │
  │      schema,sample}   │ (reference solution stays)    │
  │ run(sql) ───────────► │ ──► worker: sandbox exec ───► │ preview rows
  │ ◄── preview rows      │                               │
  │ submit(sql) ────────► │ ──► worker: run student+ref ─►│ compare
  │ ◄── result{ok,hint}   │ if ok: apply reward atomically│
```
- Challenge is bound to (playerId, rewardType, targetId, seed, expiry). Submit with mismatched binding is rejected.
- Wrong answer → lockout (config) for that challenge; hints cost cash (config).
- Switching task discards the question (a new variant next time) but keeps the draft text client-side.

## 6. Data model (SQLite)
```
questions(id, slug, tier, topic, title, story_md, schema_sql, data_gen_json,
          reference_sql, order_matters, enabled, current_version, updated_by, updated_at)
question_versions(id, question_id, version, snapshot_json, created_by, created_at)
hints(id, question_id, idx, text, cost)
variant_params(id, question_id, name, kind, spec_json)       -- see questions.md
reward_map(reward_type, target, tier_min, tier_max, pool_json) -- e.g. gun:smg → tier 3
settings(key, value_json)                                    -- gameplay numbers
users(id, email, pw_hash, role, created_at)
audit_log(id, user_id, action, entity, entity_id, diff_json, at)
attempts(id, player_ref, question_id, seed, ok, ms, at)      -- analytics (optional)
```
Game server opens the DB read-only; admin writes. Admin pings `POST /internal/reload` (shared secret) → server refreshes its in-memory caches.

## 7. World & rendering approach (summary; detail in frontend.md)
Procedural seeded city in chunks, instanced buildings/props, texture atlas + KTX2, baked AO, single sun with near-only shadows, fog/sky, bloom+FXAA, day/night, 5 bank interiors streamed on approach. Empty city (no NPCs).

## 8. Failure & safety
- Grader runs in worker threads with hard timeouts; crash → challenge cancelled, player not penalised.
- All inbound messages schema-validated and rate-limited.
- Server is the only source of truth; clients are untrusted.

## 9. Key decisions (ADR summary)
1. Browser + Three.js over Unity/Unreal — zero-install, small payload.
2. SQLite for questions/config — simple, one file, easy teacher backup.
3. Server-side grading in in-memory SQLite — identical engine for reference + student, no solution leakage.
4. Seeded variants over random question pools alone — defeats answer sharing while keeping each question reviewable.
5. Separate admin service — different auth/risk profile from game traffic.
