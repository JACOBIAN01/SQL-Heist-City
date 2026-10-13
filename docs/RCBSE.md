# RCSBE profile in SQL Heist City

How the RCSBE assessment lens (Recall, Comprehend, Solve, Build, Evaluate) and Bloom's taxonomy are used to measure what students learn in the game, and how each student's profile updates live on radar charts for students and teachers.

> **Name.** The source document calls the lens **RCSBE**, after the order of its dimensions: Recall, Comprehend, Solve, Build, Evaluate. This file uses that name. "RCBSE" in earlier notes and in this file's name means the same thing.

Source: *The RCSBE Profile*, Dev track courses, written by Krushn and Claude, reviewed by Tanmay Balwa. Worked examples: the [dimension-analysis sheet](https://docs.google.com/spreadsheets/d/13upfHbEIjxbrWyPW5C156MFlSuUX6pou-TblecNUhkk/edit?gid=71488853#gid=71488853) and [krushndayshmookh/dimension-analysis](https://github.com/krushndayshmookh/dimension-analysis).

---

## 1. The lens in one page

RCSBE classifies **assessment artifacts**, not learning outcomes. It answers two questions:
- **For one task:** what does this task actually measure?
- **For a course (here: a class's question set):** what do all its tasks add up to?

It does not replace Bloom's. Course and lecture objectives stay in Bloom's language. RCSBE is the layer used when designing a task and deciding what it is worth.

| Tag | Dimension | The student can | Decisive test |
|---|---|---|---|
| **R** | Recall | State facts, syntax, terms, definitions | Answerable from memory alone |
| **C** | Comprehend | Explain a supplied artifact: code, an error, a query plan, a schema, output | The artifact is supplied; the student explains it |
| **S** | Solve | Do a defined task inside a supplied frame | The problem says "given this" |
| **B** | Build | Ship something whose done-condition the student sets | Remove the problem statement and the student still knows what to do |
| **E** | Evaluate | Choose between viable options under real constraints and defend the choice | More than one answer is defensible; the marks are in the reasoning |

**Key rules from the source:**
- **Not a ladder.** A student has a *profile* across five dimensions, not a position on one scale. Some dependencies exist (Evaluate needs Comprehend; Build draws on Comprehend; Recall supports Comprehend), but there is no single order.
- **Solve versus Build is about who sets the frame, not difficulty.** A hard timed task with our problem and our finish line is Solve. A simple feature the student scoped and shipped is Build.
- **Exactly one tag per artifact.** If a task can't be given one tag, it tests two things and must be split. This is the whole enforcement mechanism.
- **AI is a modifier, not a dimension:**

  | Dimension | AI tools |
  |---|---|
  | Recall | off |
  | Comprehend | off |
  | Solve | on, with conditions and a penalty |
  | Build | on, with the standard raised |
  | Evaluate | on |

- **Profiles pool marks, never average percentages.** Per dimension: marks earned on items with that tag ÷ marks available on items with that tag, pooled across every assessment.
- **The lowest dimension is the remediation signal.**
- **Two separate questions:**
  - *Is the paper built right?* This is checked at design time against the course's target weights.
  - *Where does a student stand?* This is checked with per-dimension scores.

---

## 2. How RCSBE, Bloom's and Miller line up

| Bloom's | Miller | RCSBE | In SQL terms |
|---|---|---|---|
| Remember | Knows | **R** Recall | "Which clause filters groups?" (`HAVING`) |
| Understand | Knows how | **C** Comprehend | "What does this query return?", "Why does this error happen?", "Read this plan" |
| Apply | Shows how | **S** Solve | "Given these tables, return the top 3 branches by deposits" (all of today's questions) |
| Apply / Create | Does | **B** Build | "Your crew needs intel for tonight. Decide what to find out, query it, show it worked" |
| Analyze | Shows how | **C** or **S** (by what is supplied) | Analyzing a supplied query is C; analyzing data to answer a stated question is S |
| Evaluate | (beyond Does) | **E** Evaluate | "Two queries both work. Under 2 s on a 1M-row table, which one, and why?" |
| Create | Does | **B** Build | Student scopes, designs and ships |

Each question carries **both** tags:
- **Bloom:** the cognitive verb, used for course objectives and kept for curriculum alignment.
- **RCSBE:** what the task measures as an assessment.

The two are not expected to agree. A Bloom "Apply" item can be S or B depending on who sets the frame, and that is the extra information RCSBE adds.

---

## 3. What the game already has that fits the lens

| RCSBE idea | Already in the game |
|---|---|
| Solve = "given this" frame | Every SQL pop-up gives the schema, the data, a story and the expected output columns: a textbook Solve frame |
| Solve "on, with conditions, carrying a penalty" | Hints cost cash and a wrong answer locks the question for 10 s: assistance already has a stated price |
| Comprehend and Recall with AI off | The pop-up has no AI tools; nothing to change |
| One tag per artifact | Every question template is one item with one reward; adding one tag field fits the model exactly |
| Independent of the paper's shape | Per-player seeded variants: each student's items are their own, so a student's score per dimension is clean |
| Paper-QA gate | `questions:validate` already gates content; a tag-coverage check sits naturally beside it |
| Target profile per course | Classes (Phase 14) choose their own question sets, so each class gets its own target weights |

## 4. The gap today (verified)

All 150 questions are "given these tables, write a query that returns…".

| Dimension | Status | What it means |
|---|---|---|
| **S** Solve | 150 questions | Measured well |
| **R** Recall | 0 questions | Not measured |
| **C** Comprehend | 0 questions | Not measured, and this is the dimension the source calls load-bearing in the AI era |
| **B** Build | 0 questions | Not measured; needs open briefs where the student sets the done-condition |
| **E** Evaluate | 0 questions | Not measured; needs choices between working options with the marks in the reasoning |

Expected Bloom spread of today's content (to be confirmed when tagging):
- **Apply:** most questions.
- **Analyze:** some tier 4–5 questions (gaps and islands, recursive CTEs).
- **Remember, Understand, Evaluate, Create:** none.

So today a student's live radar would show one filled axis (S) and four "no data" axes. Phase 17 adds the question types that fill the other four.

---

## 5. Where RCSBE fits in the system

### 5.1 Content (questions)
Every question template gains three fields:
- **`rcsbe`:** one of `R`, `C`, `S`, `B`, `E`. Exactly one, required.
- **`bloom`:** one of `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`. Required.
- **`marks`:** the item's weight.
  - Default by tier (T1 = 1 … T5 = 5); an admin can change it per question.
  - Admin-editable like every other number (rule 3: nothing hard-coded).

These fields live in the question record, its versions, the editor, import/export and `questions:validate`. The validator refuses a question with no tag, or with more than one.

### 5.2 Classes (target profile and paper QA)
A class (Phase 14) gains a **target profile**: five weights summing to 100, optional.

When the teacher maps questions to the class, the admin shows the **paper shape**: the share of available marks per dimension in the class's question set, as a radar over the target. This answers *"is the paper built right?"* before anyone plays.

Mismatches are flagged, for example "Comprehend is 0%, target 20%". This is a design-time gate, never a student measure.

### 5.3 Attempts (evidence)
Each attempt row (Phase 15.2) stores a **snapshot** of the item's `rcsbe`, `bloom` and `marks` at the moment it was issued. Editing a question later never rewrites a student's history.

### 5.4 Profiles (live)
A profile is a set of totals, one row per student, scope and dimension:

| Column | Meaning |
|---|---|
| `student` | who |
| `scope` | `round` / `class` / `all-time` |
| `lens` | `rcsbe` or `bloom` |
| `dimension` | `R`…`E`, or `remember`…`create` |
| `earned` | marks earned |
| `available` | marks available |
| `items` | how many items counted |

The score is `earned / available`. The `items` count is the evidence behind it.

---

## 6. What counts as earned and available

The source measures exams. In a match, a student is shot at, switches tasks and leaves questions unfinished, so "an item the student sat" needs a precise rule. All thresholds below are settings.

| Event on an issued item | Available | Earned |
|---|---|---|
| Solved (correct submit) | full marks | full marks − hint penalty (each paid hint takes a share; default 25%, never below 25% of marks) |
| Wrong submits, then expired or abandoned | full marks | 0 |
| Opened and abandoned with no `Run` or `Submit` within 20 s (panic switch, shot at once) | not counted | not counted |
| Opened and worked (any `Run` or `Submit`), then abandoned or expired | full marks | 0 |
| Interrupted by death | not counted if no `Submit` yet; otherwise counted as worked | as above |
| Tutorial items (the solution is free) | not counted | not counted |

**Why:** the profile measures ability, not luck under fire. A student who opened a question and was shot two seconds later showed nothing. A student who worked on it and failed showed a real gap. Hint penalties follow the lens's "Solve with assistance carries a penalty".

**Pooling.** Totals add up raw marks across rounds, classes and time. The dimension score is always total earned ÷ total available, never an average of percentages, as the source requires for merging exams.

---

## 7. How it is analysed

**Per student:**
1. **RCSBE profile:** five scores, 0–100%, each with its evidence count.
2. **Bloom profile:** six scores, the same way.
3. **Remediation signal:** the lowest dimension that has enough evidence (default ≥ 3 items and ≥ 5 marks available). A dimension below that shows as *"not enough data"*, never as 0%.
4. **Trend:** the profile per round over time (did C rise after the review screens?).
5. **Drill-down:** per dimension, the topics and items behind the score, so "S 45%" leads to "fails `GROUP BY` with `HAVING`".

**Per class (teacher):**
1. The class profile, pooled over all its students.
2. A grid of students sorted by their weakest dimension (the remediation list).
3. The spread per dimension (box or strip plot): is a low C one student, or the whole class?
4. Paper shape versus target (section 5.2).
5. Item analysis: per question, solve rate and how well it separates strong and weak students within its dimension.

**Fairness checks:**
- Dimensions with little evidence are greyed, not scored.
- Per-player seeded variants mean scores are not inflated by copying.
- Scores ignore kills and cash entirely: only graded SQL items count.

---

## 8. Real-time updates

```
submit graded (grader)
  → attempt event (server)            item + rcsbe/bloom/marks snapshot + outcome
  → ProfileAggregator                  one upsert per (student, scope, lens, dimension)
  → push `profile` to the student      over the game socket, within the same tick
  → push to subscribed teachers        admin live channel per class (server-sent events)
```

- **Cost:**
  - One small upsert per graded item, batched per tick.
  - No full recompute; totals are additive.
  - Rebuilding the totals from raw attempts is a separate job, used to recover or audit.
- **Latency target:** the student's radar moves within 1 s of a correct submit; the teacher's within 2 s.
- **Pattern:** Observer on the existing `HeistEvents` bus (`task_solved` gains the outcome fields). The aggregator subscribes, so grading code doesn't change.
- **Server-authoritative:** the client never computes its own profile; it only draws what the server sends.

---

## 9. Radar charts

Two radars, both live:
- **RCSBE radar:** 5 axes, R, C, S, B, E.
- **Bloom radar:** 6 axes, remember → create.

| Where | Who | What it shows |
|---|---|---|
| In game, round-end card | student | this round's profile over their all-time profile (two outlines) |
| In game, profile page / pause screen | student | all-time profile; tap an axis for its topics; the remediation signal in words ("Next: practise Comprehend: predict-the-output") |
| In game, live toast | student | the axis that just moved pulses after a correct submit |
| Admin, student page | teacher | the student's profile; overlay the class average and the class target |
| Admin, class page | teacher | class profile over target; a grid of mini radars, one per student, sorted by weakest dimension; updates live during a match |
| Admin, class editor | teacher | the paper shape over the target profile (design-time QA) |

**Drawing rules:**
- **Scale:** each axis runs 0–100%.
- **Thin evidence:** an axis below the evidence threshold is dashed and grey, labelled "not enough data", not drawn at 0.
- **Readability:** labels are always the full dimension name plus the letter. Colours are colour-blind safe, with a pattern fallback.
- **Counts:** hover or tap shows `earned/available` marks and the number of items.

**Build:** one small radar module that turns `{axes, values, evidence}` into SVG paths, with no chart library (bundle budget).
- The game wraps it in plain DOM.
- The admin wraps it in React.
- Shared tests check the geometry: axis angles, scaling, and that "no data" axes are drawn dashed.

**Privacy:**
- A student sees only their own profile.
- Teachers see their classes.
- Profiles never appear on leaderboards or to other students.

---

## 10. New question types to fill R, C, B and E (Phase 17)

| RCSBE | Question type | In the game | AI | Graded by |
|---|---|---|---|---|
| R | **Quick recall:** fill the missing keyword or clause; short multiple choice | short, fast pop-ups; ideal for ammo refills | off | auto |
| C | **Predict the output:** given a query and tables, pick or build the result | in the pop-up, auto-graded | off | auto |
| C | **Explain the error:** given a failing query and its error, pick the cause | in the pop-up | off | auto |
| C | **Read the plan:** given `EXPLAIN QUERY PLAN`, say what is slow | in the pop-up | off | auto |
| S | **Write the query** (today's 150) and **fix the query** (given a broken query) | in the pop-up | none in game | auto |
| S | **Make it faster:** given a slow query, meet a cost limit | in the pop-up | none | auto (cost measured) |
| E | **Choose and defend:** two or three working queries under a stated constraint; pick one and choose the reasons | in the pop-up; the marks are in the reasons (structured choices), the pick alone earns little | allowed by the lens; none in game | auto (structured) or teacher (free text) |
| B | **Open brief:** "your crew needs intel for tonight: decide what to find out, write the queries, state how you know it worked" | between rounds (heist planning), and later through intel queries in the world (Phase 33) | on, with the bar raised | teacher rubric in the admin, with suggestions |

Build and Evaluate cost the most to mark (the source's "assessment at scale" concern).
- **Evaluate:** structured reasons keep it auto-graded.
- **Build:** graded with a rubric in a review queue in the admin, with batch tools.

A class's target profile tells the teacher how much B and E they are signing up to mark.

---

## 11. Open questions for the authors
1. **Default marks per tier:** 1–5 here. Do Dev track courses want a different scale?
2. **Hint penalty:** 25% per hint, floored at 25% of marks. Is that the right "assisted Solve" price?
3. **Abandon threshold:** 20 s with no `Run`. Is this the right rule for "the item was sat"?
4. **Target profile for this game:** suggested starting point R10 C25 S40 B10 E15, to be justified like the source's course table.
5. **Building blocks:** should the game read the [dimension-analysis](https://github.com/krushndayshmookh/dimension-analysis) format so profiles can be exported into the same sheets?
