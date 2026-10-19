# Playtests, usability sessions and the bug bash (Phase 23.5–23.7)

These need people. Everything below is ready to run; nothing here has been run yet. Findings go in `docs/review/findings.md` (create it from the template at the end) with the severity scale from `docs/testing.md`.

## 23.5 Internal playtests: three scripted sessions
Who: 6–12 people from the team or friends who know SQL. One facilitator, one note-taker. 45 minutes each. Use staging (or a local stack with `npm run dev:*`).

| Session | Goal | Setup | Script |
|---|---|---|---|
| 1. First ten minutes | Can a new player get started? | Fresh accounts; tutorial on; no hints from the facilitator | Sign in → tutorial to the end → join the class room. Note every stall over 20 s |
| 2. A full round | Does the loop hold together? | One class room, 8–12 players, 15-minute round | Play a round; at 10 minutes the facilitator ends it. Watch heals mid-fight, vault races, banking |
| 3. Stress and fairness | Does it still work at size and is it fair? | As many players as available, plus scripted bots to reach 60 (`npm run bot -w @heist/server -- 50`) | Hold a round; note lag, unfair deaths, anyone locked out of a task |

Observe, do not help. Write down: what they said out loud, where they looked, what they tried that did not work, what made them laugh, what made them quit a task.

### Survey (5 minutes after each session, 1–5 unless noted)
1. I understood what to do in the first minutes.
2. The SQL questions were the right difficulty. (1 too easy – 5 too hard)
3. Solving a question while someone shoots at me was exciting, not just stressful.
4. I always knew why I died.
5. The controls felt right (mouse, keys). What would you change? (free text)
6. The picture and sound were clear. Anything hard to see or hear? (free text)
7. I would play another round. (yes / maybe / no) and why?
8. The one thing to fix first. (free text)

Exit: three sessions held, every note turned into a finding (or "no action"), and the survey results summarised in the findings file.

## 23.6 Usability tests with students
Who: 5–8 students of the target age, with their teacher's and guardians' consent (inputs-needed #13). Never record faces; screen and audio only, with permission, deleted after the notes are written.

Format: one student at a time, 25 minutes, think-aloud. The facilitator reads the same intro each time and answers no questions about how to play ("What would you do next?").

Tasks, in order:
1. Starting from the web address, get into the game with the code on the board.
2. Heal yourself.
3. Get a gun and shoot a target.
4. Open a vault.
5. Change the text size and one key in the settings.
6. Tell me what the top bar and the minimap are for.

Measure per task: done without help (yes/no), time, number of wrong turns, quotes. First-time-user flow = tasks 1–2; any student who cannot do them unaided is a severity S2 finding.

## 23.7 Bug bash
One 2-hour session with everyone available, after the playtest fixes. Each person takes a theme and tries to break it:

- Sign-in and consent: wrong class code, a locked class, an archived class, two tabs, back button.
- The SQL panel: very long queries, forbidden statements, pasting, minimising mid-query, dying with the panel open, a wrong answer five times.
- Combat and cars: shooting through corners, car and stairs, respawn, spawn protection.
- Vaults and money: two players on one vault, dying while carrying, banking while hurt, leaving mid-vault.
- Class controls (teacher): start, end round, next round, kick, lock, stop; students reconnecting.
- Settings: remap into conflicts, mouse buttons, Hindi text, large text, each colour palette, gamepad, touch.
- Admin: edit a question while it is being played; import errors.

Exit: no S1 or S2 open (`docs/testing.md`); S3 and S4 triaged into the backlog.

## Findings template (`docs/review/findings.md`)
| # | Found in | What happened | Expected | Severity | Owner | Status |
|---|---|---|---|---|---|---|
