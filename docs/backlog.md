# Backlog (ideas outside the current phase)

- Teams/squads and shared vault progress
- Gamepad support
- Voice/proximity chat
- Replays/killcam
- Student accounts + progress tracking across sessions
- Teacher-led classroom rooms with live dashboards
- More SQL dialects (Postgres/MySQL flavour packs)
- Mobile/touch controls
- Structural question variants (table/column renames, story theme swap) — designed in questions.md, deferred from Phase 1.7
- Game side of pools: a match/room restricts QuestionSelector to a pool's questions (needs rooms; Phase 7+). Admin pool CRUD exists since 2.11.
- Admin analytics (solve rate, median time, wrong-answer rate per question): needs the game to record attempts; build once Phase 7 produces data.
- Character draw calls: the procedural student is 6 meshes (6 draw calls). With ~30 visible players (AOI cap) that is ~180 calls, right at the 200 budget. Phase 6/9: merge each character into one skinned or instanced mesh before more props are added.
- Admin-editable reward icons (an `icon` field per reward in the DB + picker); today the reward → icon map lives in client code.
