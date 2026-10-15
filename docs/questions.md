# Questions

All questions are **data** (DB rows, editable in admin). This doc defines format, variant system, tiers, and the 150-question seed curriculum.

## Template (JSON, import/export format)
```json
{
  "slug": "emp-high-earners-dept",
  "tier": 1,
  "topic": ["select", "where"],
  "title": "Payroll Leak",
  "story_md": "List the names of employees in **{dept}** who earn more than **{min_salary}**.",
  "schema_sql": "CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, dept TEXT, salary INTEGER);",
  "data_gen": { "employees": { "rows": [30, 60], "columns": {
      "id": {"kind": "serial"},
      "name": {"kind": "pick", "from": "first_names"},
      "dept": {"kind": "pick", "from": ["Teller","Security","Audit","IT"]},
      "salary": {"kind": "int", "min": 2000, "max": 9000, "step": 100} } } },
  "params": {
    "dept": {"kind": "pick", "from": ["Teller","Security","Audit","IT"]},
    "min_salary": {"kind": "int", "min": 3000, "max": 6000, "step": 500} },
  "reference_sql": "SELECT name FROM employees WHERE dept = {dept|sql} AND salary > {min_salary};",
  "order_matters": false,
  "compare": {"names": false, "case": true},
  "allow_empty": false,
  "hints": [ {"text": "Combine two conditions with AND.", "cost": 0.05} ],
  "enabled": true
}
```
`{param}` is substituted in story/reference; `|sql` emits an escaped SQL literal. Hint cost mode (fraction of carried cash vs absolute) is a setting.

## Variant system (anti-copy)
Seed = hash(matchSeed, playerId, rewardType, attemptCounter).
1. Params resolved from seed (`pick`, `int`, `date`, `bool`).
2. Table data generated from seed via `DataGenerator`s (`serial`, `pick`, `int`, `real`, `date`, `text_pattern`, `fk`, `weighted`) — a Factory keyed by `kind` (Open/Closed: new generator = new class).
3. Optional structural variants (Phase 17.12): a question's `themes` list (`name`, optional `title`, `tables` and `columns` rename maps, `words` for prose). Each player gets the plain question or one theme, from its own seed stream (`<seed>/theme`), so adding a theme never changes params or data. Renames apply to the schema, generated tables, reference and every task SQL (whole words, never inside '…' literals); `words` swap in the story, prompts and options (capitals kept), and names in `code` spans and **bold** are renamed like SQL. The template refuses renames of names that do not exist or that clash. The bank-based task-kind questions all have a `casino` theme (accounts → players, transactions → bets, balance → chips, branch → floor).
4. Reference SQL on generated data = expected result; a copied query returns different rows → fails.
5. Selector never repeats a question for the same player+reward until the pool is exhausted.
6. Guards at save and in `questions:validate`: ≥1 row (unless allowed), ≤ row cap, at most 5% of player pairs (seed pairs) share the same answer, measured on 100 seeds, runtime <200 ms.

## Worked example ("Expected output", Phase 10.2)
Every issued task also carries a worked example, LeetCode style: the player's own question (same parameters: same filter, same threshold) run on **separate example data**, never on the player's real tables. The pop-up shows the output's columns, the comparison rules (do names matter, does row order) and the example's input tables and output.
- Example data comes from its own seed (`<seed>/example-k`) and is small: `exampleRows` (6) rows per table, then 12, then 18 over `exampleTries` (3) tries, then one full-size try. The first try whose answer has rows is kept. Rows on show are capped at `exampleShownRows` (10). All three are challenge settings.
- Why it is safe: grading runs on the real data, so writing the example's rows out as literals is graded wrong (a test checks this).
- Built by `ExampleBuilder` (server) for the game, the admin preview ("Players' worked example") and the QA gate. `questions:validate` fails a question if any of its first 10 seeds gets no example with rows; all 150 pass.

## Task kinds (Phase 17.1)
A question's `task` says what the student does (default `{"kind": "write"}`). Each kind is one server handler (`server/src/challenges/tasks/handlers.ts`, Strategy) and one pop-up view (`client/src/ui/sql/TaskView.ts`); the QA gate and admin preview run the same handler.

| kind | RCSBE | Student does | Graded by | Fields |
|---|---|---|---|---|
| `write` | S | writes a SELECT | rows vs reference | — |
| `fix` | S | repairs a given query (pre-filled in the editor) | rows vs reference | `broken_sql` |
| `faster` | S | rewrites a slow query | rows, then at most `max_scans` `SCAN` lines in `EXPLAIN QUERY PLAN` | `slow_sql`, `max_scans` |
| `write_db` | S | INSERT / UPDATE / DELETE / CREATE TABLE·INDEX | `check_sql` run after their statements vs after the reference's | `check_sql` |
| `choice` | R, C, E | picks options (one go); a query, its result, error or plan can be shown | exact set per part, weighted; reward at `pass_share`, the profile gets the share | `show_sql`, `show`, `parts[]`, `pass_share` |
| `fill` | R | fills `___` blanks (one go) | each blank against `accept[]`, ignoring case and spaces | `text_sql`, `blanks[]` |
| `brief` | B | writes goal, done-condition and queries | handed in; a teacher marks it against `rubric[]` (17.11) | `rubric[]` |

- `reference_sql` is required for SQL kinds and empty for the others. Choice/fill/brief have no worked example; choice/fill have no Run button.
- Write tasks run in a writable sandbox (`mode: 'write'`): only the listed statements are allowed (no ATTACH, PRAGMA, triggers, transactions, schema-table writes); the check query then runs read-only.
- One-go answers end the question: `answered` (part marks, no reward) or `submitted` (brief, counted once marked). The right options and accepted blanks never reach the client.
- The QA gate fails a `fix`/`faster` question whose given query already passes.

## Tiers
| Tier | Level | Topics |
|---|---|---|
| 1 | Easy | SELECT, WHERE, ORDER BY, LIMIT, DISTINCT |
| 2 | Basic+ | aggregates, GROUP BY, HAVING, CASE, string/date basics, NULLs |
| 3 | Medium | INNER/LEFT JOIN, multi-table, subqueries, set ops |
| 4 | Hard | CTEs, self-joins, correlated subqueries, window functions |
| 5 | Expert | recursive CTEs, gaps-and-islands, top-N per group, pivots, multi-step analytics |

## Default reward → tier (editable)
heal small 1 · heal medium 3 · heal full 4 · ammo 1 · pistol 1 · SMG/shotgun 3 · rifle 4 · sniper 5 · vault lock k = min(5, bankTier + k − 1).

## 150-question seed curriculum (30 per tier)
- **T1:** select columns 4, WHERE numeric 5, text/LIKE 5, AND/OR/NOT 4, IN/BETWEEN 4, ORDER BY 3, LIMIT/OFFSET 2, DISTINCT 3.
- **T2:** COUNT/SUM/AVG/MIN/MAX 8, GROUP BY 8, HAVING 5, CASE 3, string funcs 3, date funcs 3.
- **T3:** INNER JOIN 7, LEFT JOIN + NULL 6, 3-table joins 4, IN/EXISTS 6, scalar subquery 3, UNION/INTERSECT/EXCEPT 4.
- **T4:** CTE 6, self-join 4, correlated subquery 5, ROW_NUMBER/RANK 6, LAG/LEAD 4, running totals/moving avg 5.
- **T5:** recursive CTE 6, gaps-and-islands 5, top-N per group 5, pivot via CASE 4, multi-CTE analytics 5, advanced windows/percentiles 5.

Themes follow the heist fiction (accounts, transactions, staff, vault logs, alarms, shifts, branches).

## Seed content files
`content/questions/tier-1.json` … `tier-5.json` (export format, 30 questions each) are the shipped seed set. They are data: load them with `npm run db:seed`, then teachers edit questions in the admin. Shared tables used across questions: employees, branches, accounts, transactions, loans, vault_items, vault_logs, alarms, shifts, cameras, crew (hierarchy via `tree_parent`), tunnels (graph). Conventions: every ORDER BY / window has an explicit tie-breaker stated in the story; averages and ratios say how to round; scalar answers return extra columns so players rarely share an answer.

`content/questions/kinds-*.json` (Phase 17) add 100 questions of the other task kinds, so R, C and E have content: `kinds-recall` (20: fill the keyword, quick choice), `kinds-predict` (15: predict the output), `kinds-errors` (10: explain the error), `kinds-plans` (10: read the plan), `kinds-fix` (10), `kinds-faster` (10), `kinds-write` (10: write to the database), `kinds-defend` (15: choose and defend; most marks on the reason). `kinds-coverage` (10) fills the tier × RCSBE and tier × Bloom cells that were empty (tier 1 Evaluate; Recall and Comprehend at tiers 4–5); `questions:validate` now fails when any enabled-question cell is empty. They were first generated by `tools/content/kinds.py`; edit the JSON (or the admin) from now on. Predict/error questions use `list` columns, so every player sees the same small tables and the right option does not depend on the data; option order is shuffled per player instead.

## Authoring/QA workflow
JSON → admin import `--dry-run` → fix → `npm run questions:validate` → teacher spot-check in preview → enable.

## Dialect
SQLite 3.4x (CTEs, recursive CTEs, window functions). Stories note quirks (e.g. `strftime`); admin shows a dialect cheat-sheet.

**Dialect packs (Phase 17.14).** Grading always runs SQLite, but a class can say which dialect its students learn (class setting `dialect`: `sqlite`, `postgres` or `mysql`). A pack (settings section `dialects`, edited under Settings → Dialect packs) has a short intro and one entry per quirk: `integer-division`, `string-concat`, `limit-offset`, `dates`, `like-case`, `bare-columns`, `nulls-order`, `upsert`, `types`, `autoincrement`, `boolean`, `quoting` — each a note plus the SQLite and the dialect form. A question's quirks are its own `quirks` list plus what `detectQuirks` finds in its reference and task SQL. When a class is not on SQLite, the pop-up shows "<Dialect> notes": the entries this question touches first (open), and the rest of the pack as the cheat-sheet.
