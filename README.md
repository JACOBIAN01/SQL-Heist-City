# SQL Heist City

Multiplayer browser game: students in an empty city rob 5 banks, but every vault lock, heal, and gun costs a SQL question — while other players shoot them. Teachers manage all questions through an admin backend.

**Status:** Phase 5 built (walk & shoot sandbox) — awaiting review.

Try the game: `npm run dev:server` + `npm run dev:client` → http://localhost:5173 (open two tabs, or add bots with `npm run bot -w @heist/server -- 3`). Click to capture the mouse; WASD, Shift, Ctrl, Space, left-click to fire.

Try the panel: `npm run dev:admin` once (creates the DB), `npm run db:seed`, then `npm run dev:server` and `npm run dev:client` → http://localhost:5173/sql-demo.html

```
npm install
npm run ci          # verify everything
npm run dev:client  # http://localhost:5173
```

Start with [CLAUDE.md](CLAUDE.md), then `docs/`: Architecture · system-design · Phases · rules · design-principles · frontend · backend · admin · questions · gameplay · api-protocol · testing · deployment · backlog.
