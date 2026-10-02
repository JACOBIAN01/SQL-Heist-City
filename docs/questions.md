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
3. Optional structural variants: table/column renames, story theme swap.
4. Reference SQL on generated data = expected result; a copied query returns different rows → fails.
5. Selector never repeats a question for the same player+reward until the pool is exhausted.
6. Guards at save and in `questions:validate`: ≥1 row (unless allowed), ≤ row cap, at most 5% of player pairs (seed pairs) share the same answer, measured on 100 seeds, runtime <200 ms.

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

## Authoring/QA workflow
JSON → admin import `--dry-run` → fix → `npm run questions:validate` → teacher spot-check in preview → enable.

## Dialect
SQLite 3.4x (CTEs, recursive CTEs, window functions). Stories note quirks (e.g. `strftime`); admin shows a dialect cheat-sheet.
