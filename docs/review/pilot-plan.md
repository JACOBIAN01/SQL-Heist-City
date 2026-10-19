# Classroom pilot plan (Phase 24.1)

Status: **ready for the owner to approve.** Nothing is run until schools, teachers and consent are in hand (docs/inputs-needed.md #13).

## Question the pilot answers
1. Do students **learn** SQL from playing? (pre/post test gain, per topic)
2. Is it **fun** enough to want another round? (survey, rounds started voluntarily)
3. Does it **work in a real classroom**? (devices, network, teacher workload, bugs)

## Who
- 2–3 schools, one teacher each, **one class of 60 or more** per school (a second smaller class if available).
- Mixed devices as schools have them; record them (this also fills the 22.6 table).
- A control: where possible, a parallel class of similar level taking the same tests after normal teaching. If none, the pilot reports gain without a control and says so.

## Before
- Terms accepted by the school in the class editor (the violent-game statement included) and guardians' consent collected by the school on the forms from `docs/legal/` (reviewed, #11).
- Teacher walk-through (30 min): create the class, release questions, start, end a round, read the results, the briefs.
- Pre-test (the class's `pre` assessment, 15–20 questions across tiers 1–3) on a day before the first session.

## Sessions
Per class: **4 sessions over 2 weeks**, 40 minutes each.

| # | Content |
|---|---|
| 1 | Tutorial, then a 15-minute round on tier 1–2 |
| 2 | Full round; teacher watches the class results live |
| 3 | Full round with the teacher's chosen topic emphasised (released questions) |
| 4 | Full round, then the **post-test** and the survey |

A researcher or one of us is present for sessions 1 and 4 and available remotely for 2 and 3.

## Data (all inside the product; nothing new collected)
- Learning: pre and post `assessments`, attempts per concept and tier, hints used, time to solve (`docs/analytics`-style data already kept).
- Engagement: rounds started, tasks attempted, streaks, return across sessions.
- Fun and clarity: the student survey (below) and the teacher interview.
- Technical: `/metrics` tick and bandwidth, client error reports (scrubbed), the teacher's incident notes.

## Student survey (end of session 4, anonymous)
1–5: I enjoyed it · I learned something about SQL · I would play again · The questions were too easy/too hard · I understood why I died · It worked on my computer. Free text: best part, worst part.

## Teacher interview (20 minutes after session 4)
What did you do differently because of the results page? What took more effort than it should? What would stop you using it every week? Did anything feel unfair or unsafe?

## Success criteria (agreed up front)
- Post-test mean beats pre-test mean in every class, with an effect noted per concept.
- At least 70 % of students would play again.
- No S1 and no S2 bug open at the end (`docs/testing.md`); the game ran every session without a restart.
- Teachers say they would use it again.
A miss is a finding, not a failure: it goes in the report with a proposed change.

## Safeguards
- Students can quit any time, delete their account in the menu, and the school can erase a class (docs/privacy.md).
- No names beyond display names leave the product; the report uses class-level numbers and unattributed quotes.
- Stop rule: if a session shows distress or a safety problem, the teacher stops it; we review before the next one.

## After
`docs/review/pilot.md` (24.3): learning gain per concept, fun, retention, bugs, teacher feedback, and a list of changes. Critical and major findings are fixed and re-checked (24.4) before launch.
