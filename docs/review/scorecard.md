# GTA scorecard (Phase 36)

The gate: **every pillar at least 8/10, scored with playtest evidence**, not the author's own reading of the code. This page is the form to fill in once `docs/review/playtests.md` sessions and the pilot (`docs/review/pilot-plan.md`) have run. Nothing below is a playtest result yet.

## How a pillar is scored
1. The facilitator runs the sessions in `playtests.md` and adds the pillar questions below to the survey (1–5, 5 = strongly agree).
2. A pillar's score is `2 × the median answer` across players, then **capped at 7 if any evidence row for it is missing** and **lowered by one for each unresolved severity-1 finding** (scale in `docs/testing.md`) that touches it.
3. Findings go in `docs/review/findings.md`. A pillar under 8 becomes a 36.2 fix, then is re-scored with a fresh session.

## Where each pillar stands
"Own reading" is the author's assessment in the linked review, from code, tests and screenshots. It is a prediction to test, not a score.

| Pillar | Audit score | Own reading | Review |
|---|---|---|---|
| World immersion | 5 | 8 | [immersion](immersion.md) |
| Exploration | 3 | 8 | [exploration](exploration.md) |
| Missions | 3 | 8 | [missions](missions.md) |
| Story | 1 | 8 (the story text still needs the owner's approval, `docs/story.md`) | [story](story.md) |
| Progression | not re-read since Phase 26 | to be read in 36.1 | Phase 26 rows in `Phases.md` |
| Freedom | 5 | 8 | [exploration](exploration.md) |
| Rewards | not re-read since Phase 26 | to be read in 36.1 | Phase 26 rows in `Phases.md` |
| SQL fit | 4 | 8 | [sql-fit](sql-fit.md) |

## Survey questions per pillar (add to the end of each session)
| Pillar | Question | Evidence to collect |
|---|---|---|
| World immersion | The city felt alive: I saw people, weather, sound and police react to me. | a recorded walk through two districts at day and night |
| Exploration | I found something I wanted by walking, without a marker telling me. | the count of caches, chips and districts each player found, from the collection store |
| Missions | I always knew my next job and why I was doing it. | jobs started and finished per player in the round report |
| Story | I cared what happened to the crew. | the share of players who opened a scene and read to its end |
| Progression | I could see myself getting better, in rank and in SQL. | rank and mastery before and after, from the profile page |
| Freedom | I could pick how to do a heist (loud or quiet, alone or with others). | the split of stealth and loud approaches, solo and squad |
| Rewards | What I got felt worth the question I solved. | cash and XP per question against time, per tier |
| SQL fit | Writing SQL felt like part of the heist, not a gate beside it. | city database queries per player, and kill-cam "last answer" times |

## Score sheet (fill in at 36.1)
| Pillar | Median (1–5) | Missing evidence | Open severity-1 | Score |
|---|---|---|---|---|
| World immersion | | | | |
| Exploration | | | | |
| Missions | | | | |
| Story | | | | |
| Progression | | | | |
| Freedom | | | | |
| Rewards | | | | |
| SQL fit | | | | |

The gate passes when the Score column is 8 or more on every row.
