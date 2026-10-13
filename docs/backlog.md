# Backlog (ideas outside the current phase)

> Since the October 2026 audit, most of this list is scheduled in docs/Phases.md: teams (27), gamepad and touch (22), replays and kill-cam (35), student accounts and progress (13, 26), classroom rooms and dashboards (14, 15), dialect packs (17.7), structural variants (17.5), the game side of pools (14.4), admin analytics (15.8), reward icons (12.5). Voice and chat stay out of scope for now.

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
- Character cost with real humans: each is 3 draw calls (body, hair, eyes) and ~5k triangles, so ~30 visible players ≈ 100 calls / 150k triangles before shadows. Phase 6 should add a low-detail model (≈1.5k triangles) for players beyond ~25 m.
- Admin-editable reward icons (an `icon` field per reward in the DB + picker); today the reward → icon map lives in client code.
- Vehicles and street furniture are not in the free city kit: hand-download the Quaternius Cars pack (Google Drive) or build simple procedural ones; lamps/hydrants/trees likewise (see city-kit.md).
