"""
Builds the Phase 17 question files (content/questions/kinds-*.json): recall, predict the
output, explain the error, read the plan, fix, faster, write to the database, choose and defend.

    python3 tools/content/kinds.py

The JSON files are the source of truth once written (teachers edit them in the admin); this
script only exists so the first batch is consistent. Re-running overwrites the kinds-*.json files.
"""
import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parents[2] / 'content' / 'questions'

# --- shared tables ---------------------------------------------------------------------------

BANK_SCHEMA = (
    'CREATE TABLE accounts (id INTEGER PRIMARY KEY, owner TEXT, branch TEXT, balance INTEGER, opened TEXT);\n'
    'CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER, amount INTEGER, at TEXT);'
)
BRANCHES = ['North', 'South', 'East', 'West', 'Harbor']
# A short name list, so a name a question asks about has accounts on every seed.
OWNERS = ['Ana', 'Ben', 'Cy', 'Di', 'Eli', 'Fay', 'Gus', 'Hal', 'Ida', 'Jo', 'Kai', 'Lu']
BANK_DATA = {
    'accounts': {
        'rows': [40, 60],
        'columns': {
            'id': {'kind': 'serial'},
            'owner': {'kind': 'pick', 'from': OWNERS},
            'branch': {'kind': 'pick', 'from': BRANCHES},
            'balance': {'kind': 'int', 'min': 0, 'max': 20000, 'step': 1},
            'opened': {'kind': 'date', 'from': '2015-01-01', 'to': '2025-12-31'},
        },
    },
    'transactions': {
        'rows': [60, 90],
        'columns': {
            'id': {'kind': 'serial'},
            'account_id': {'kind': 'fk', 'table': 'accounts', 'column': 'id'},
            'amount': {'kind': 'int', 'min': -2000, 'max': 3000, 'step': 10},
            'at': {'kind': 'date', 'from': '2023-01-01', 'to': '2025-12-31'},
        },
    },
}
BANK_INDEXES = (
    '\nCREATE INDEX accounts_owner ON accounts(owner);'
    '\nCREATE INDEX accounts_branch ON accounts(branch);'
    '\nCREATE INDEX accounts_balance ON accounts(balance);'
    '\nCREATE INDEX transactions_account ON transactions(account_id);'
    '\nCREATE INDEX transactions_at ON transactions(at);'
)

EMP_SCHEMA = (
    'CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, dept TEXT, salary INTEGER, manager_id INTEGER);'
)
EMP_DATA = {
    'employees': {
        'rows': [30, 45],
        'columns': {
            'id': {'kind': 'serial'},
            'name': {'kind': 'pick', 'from': 'first_names'},
            'dept': {'kind': 'pick', 'from': 'departments'},
            'salary': {'kind': 'int', 'min': 2000, 'max': 9000, 'step': 100},
            'manager_id': {'kind': 'int', 'min': 1, 'max': 6, 'null_rate': 0.25},
        },
    },
}


def fixed(name, columns, rows):
    """A table every player sees the same (list columns, fixed row count)."""
    cols = {c: {'kind': 'list', 'values': [r[i] for r in rows]} for i, c in enumerate(columns)}
    return {name: {'rows': len(rows), 'columns': cols}}


def sql_type(v):
    return 'INTEGER' if isinstance(v, int) else 'REAL' if isinstance(v, float) else 'TEXT'


def fixed_schema(name, columns, rows, pk='id'):
    types = []
    for i, c in enumerate(columns):
        sample = next((r[i] for r in rows if r[i] is not None), '')
        t = sql_type(sample)
        types.append(f'{c} {t}{" PRIMARY KEY" if c == pk else ""}')
    return f'CREATE TABLE {name} ({", ".join(types)});'


STAFF_COLS = ['id', 'name', 'dept', 'salary', 'bonus']
STAFF_ROWS = [
    [1, 'Ana', 'Vault', 5200, 300],
    [2, 'Ben', 'Teller', 3100, None],
    [3, 'Cy', 'Vault', 6100, 100],
    [4, 'Di', 'Audit', 4400, None],
    [5, 'Eli', 'Teller', 2900, 100],
    [6, 'Fay', 'Vault', 5200, 200],
]
STAFF = {
    'schema_sql': fixed_schema('staff', STAFF_COLS, STAFF_ROWS),
    'data_gen': fixed('staff', STAFF_COLS, STAFF_ROWS),
}

BOX_COLS = ['id', 'owner_id', 'size']
BOX_ROWS = [[1, 1, 'S'], [2, 1, 'L'], [3, 3, 'M'], [4, 9, 'S']]
STAFF_BOXES = {
    'schema_sql': STAFF['schema_sql'] + '\n' + fixed_schema('boxes', BOX_COLS, BOX_ROWS),
    'data_gen': {**STAFF['data_gen'], **fixed('boxes', BOX_COLS, BOX_ROWS)},
}

BANK = {'schema_sql': BANK_SCHEMA, 'data_gen': BANK_DATA}
BANK_IX = {'schema_sql': BANK_SCHEMA + BANK_INDEXES, 'data_gen': BANK_DATA}
EMP = {'schema_sql': EMP_SCHEMA, 'data_gen': EMP_DATA}


def opts(*texts):
    return [{'id': chr(97 + i), 'text_md': t} for i, t in enumerate(texts)]


def part(prompt, options, correct, weight=1, multi=False):
    """`correct` is the index (or list of indexes) of the right option(s)."""
    ids = [correct] if isinstance(correct, int) else correct
    return {
        'prompt_md': prompt,
        'options': opts(*options),
        'correct': [chr(97 + i) for i in ids],
        'multi': multi,
        'weight': weight,
    }


def q(slug, tier, topic, title, rcsbe, bloom, story, base, task, reference='', hints=(), params=None, **extra):
    out = {
        'slug': slug,
        'tier': tier,
        'topic': topic,
        'title': title,
        'rcsbe': rcsbe,
        'bloom': bloom,
        'story_md': story,
        'schema_sql': base['schema_sql'],
        'data_gen': base['data_gen'],
        'params': params or {},
        'task': task,
        'reference_sql': reference,
        'hints': [{'text': h, 'cost': 0.05} for h in hints],
    }
    out.update(extra)
    return out


def fill(text_sql, *accepts):
    return {'kind': 'fill', 'text_sql': text_sql, 'blanks': [{'accept': list(a)} for a in accepts]}


def choice(parts, show_sql=None, show='query', pass_share=1, shuffle=True):
    t = {'kind': 'choice', 'parts': parts, 'pass_share': pass_share, 'shuffle': shuffle, 'show': show}
    if show_sql:
        t['show_sql'] = show_sql
    return t


# --- 17.2 Recall: fill the keyword, quick multiple choice --------------------------------------

recall = [
    q('r-fill-where', 1, ['where'], 'Filter the Rows', 'R', 'remember',
      'Fill the blank so the query returns only employees earning more than 5000.', EMP,
      fill('SELECT name FROM employees ___ salary > 5000;', ['WHERE'])),
    q('r-fill-group-by', 1, ['group-by'], 'One Row per Department', 'R', 'remember',
      'Fill the blank so the query counts employees in each department.', EMP,
      fill('SELECT dept, COUNT(*) FROM employees ___ dept;', ['GROUP BY'])),
    q('r-fill-having', 2, ['having'], 'Only Big Departments', 'R', 'remember',
      'Fill the blank so only departments with more than 3 employees are returned.', EMP,
      fill('SELECT dept, COUNT(*) FROM employees GROUP BY dept ___ COUNT(*) > 3;', ['HAVING'])),
    q('r-fill-order-by', 1, ['order-by'], 'Richest First', 'R', 'remember',
      'Fill the blanks so the best paid employees come first.', EMP,
      fill('SELECT name, salary FROM employees ___ salary ___;', ['ORDER BY'], ['DESC'])),
    q('r-fill-distinct', 1, ['distinct'], 'Each Department Once', 'R', 'remember',
      'Fill the blank so each department appears only once.', EMP,
      fill('SELECT ___ dept FROM employees;', ['DISTINCT'])),
    q('r-fill-limit', 1, ['limit', 'top-n'], 'Top Five', 'R', 'remember',
      'Fill the blank so only the five best paid employees are returned.', EMP,
      fill('SELECT name FROM employees ORDER BY salary DESC ___ 5;', ['LIMIT'])),
    q('r-fill-join', 2, ['join'], 'Owners and Their Money Moves', 'R', 'remember',
      'Fill the blanks to pair every transaction with its account.', BANK,
      fill('SELECT a.owner, t.amount FROM accounts a ___ transactions t ___ t.account_id = a.id;',
           ['JOIN', 'INNER JOIN'], ['ON'])),
    q('r-fill-left-join', 2, ['left-join'], 'Keep Quiet Accounts', 'R', 'remember',
      'Fill the blank so accounts **without** transactions are kept too (with NULL amounts).', BANK,
      fill('SELECT a.owner, t.amount FROM accounts a ___ transactions t ON t.account_id = a.id;',
           ['LEFT JOIN', 'LEFT OUTER JOIN'])),
    q('r-fill-is-null', 1, ['null'], 'No Manager', 'R', 'remember',
      'Fill the blank to find employees with no manager (an empty `manager_id`).', EMP,
      fill('SELECT name FROM employees WHERE manager_id ___;', ['IS NULL'])),
    q('r-fill-like', 1, ['like'], 'Names Starting with A', 'R', 'remember',
      'Fill the blank so the query finds names starting with A.', EMP,
      fill("SELECT name FROM employees WHERE name ___ 'A%';", ['LIKE'])),
    q('r-fill-case', 2, ['case'], 'Label the Pay', 'R', 'remember',
      'Fill the blanks to label each salary as high or normal.', EMP,
      fill("SELECT name, ___ WHEN salary > 6000 THEN 'high' ELSE 'normal' ___ AS band FROM employees;",
           ['CASE'], ['END'])),
    q('r-fill-with', 3, ['cte'], 'Name the Subquery', 'R', 'remember',
      'Fill the blanks to define a named subquery (a CTE) and use it.', BANK,
      fill('___ big ___ (SELECT * FROM accounts WHERE balance > 10000) SELECT COUNT(*) FROM big;',
           ['WITH'], ['AS'])),
    q('r-choice-having', 1, ['having', 'where'], 'Filter After Grouping', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('Which clause keeps or drops **groups** after `GROUP BY`?',
                   ['`HAVING`', '`WHERE`', '`ORDER BY`', '`LIMIT`'], 0)])),
    q('r-choice-count-star', 1, ['count', 'null'], 'Counting Rows', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('Which one counts **every** row, even rows where `manager_id` is NULL?',
                   ['`COUNT(*)`', '`COUNT(manager_id)`', '`SUM(manager_id)`', '`COUNT(DISTINCT manager_id)`'], 0)])),
    q('r-choice-clause-order', 1, ['select', 'group-by'], 'Clause Order', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('In which order are these clauses written?',
                   ['SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY',
                    'SELECT, WHERE, FROM, GROUP BY, ORDER BY, HAVING',
                    'FROM, SELECT, WHERE, HAVING, GROUP BY, ORDER BY',
                    'SELECT, FROM, GROUP BY, WHERE, ORDER BY, HAVING'], 0)])),
    q('r-choice-left-join', 1, ['left-join', 'join'], 'Which Join Keeps Them', 'R', 'remember',
      'Quick check.', BANK,
      choice([part('Which join keeps every account, even those with no transactions?',
                   ['`accounts LEFT JOIN transactions`', '`accounts JOIN transactions`',
                    '`accounts INNER JOIN transactions`', '`transactions LEFT JOIN accounts`'], 0)])),
    q('r-choice-union', 2, ['union'], 'Duplicates Out', 'R', 'remember',
      'Quick check.', BANK,
      choice([part('Which one combines two results **and removes duplicate rows**?',
                   ['`UNION`', '`UNION ALL`', '`JOIN`', '`INTERSECT ALL`'], 0)])),
    q('r-choice-dense-rank', 3, ['dense-rank', 'rank', 'row-number'], 'Ties Without Gaps', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('Which window function gives tied rows the same number and leaves **no gaps** (1, 1, 2)?',
                   ['`DENSE_RANK()`', '`RANK()`', '`ROW_NUMBER()`', '`NTILE(2)`'], 0)])),
    q('r-choice-null-equals', 2, ['null'], 'Equal to Nothing', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('What is `manager_id = NULL` for every row?',
                   ['NULL (unknown), so `WHERE` keeps no rows', 'TRUE when manager_id is empty',
                    'FALSE for every row, so NOT keeps them all', 'An error'], 0)])),
    q('r-choice-alias', 1, ['select'], 'Rename a Column', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('Which keyword gives an output column a new name?',
                   ['`AS`', '`ON`', '`IS`', '`IN`'], 0)])),
]

# --- 17.3 Predict the output -------------------------------------------------------------------

def predict(slug, tier, topic, title, sql, prompt, options, correct, base=STAFF, extra_parts=()):
    return q(slug, tier, topic, title, 'C', 'understand',
             'Read the query and the tables. Without running anything, what does it return?', base,
             choice([part(prompt, options, correct), *extra_parts], show_sql=sql))

predicts = [
    predict('c-predict-count-null', 1, ['count', 'null'], 'Count the Bonuses',
            'SELECT COUNT(*), COUNT(bonus) FROM staff;', 'What does it return?',
            ['6, 4', '6, 6', '4, 4', '6, 2'], 0),
    predict('c-predict-distinct', 1, ['distinct', 'count'], 'How Many Departments',
            'SELECT COUNT(DISTINCT dept) FROM staff;', 'What does it return?',
            ['3', '6', '2', '1'], 0),
    predict('c-predict-group-rows', 1, ['group-by'], 'Rows After Grouping',
            'SELECT dept, SUM(salary) FROM staff GROUP BY dept;', 'How many rows does it return?',
            ['3', '6', '1', '5'], 0),
    predict('c-predict-not-equal-null', 2, ['null', 'where'], 'Not 100',
            'SELECT name FROM staff WHERE bonus <> 100;', 'Which names does it return?',
            ['Ana, Fay', 'Ana, Ben, Di, Fay', 'Ben, Di', 'Ana, Cy, Eli, Fay'], 0),
    predict('c-predict-avg-null', 2, ['avg', 'null'], 'Average Bonus',
            'SELECT AVG(bonus) FROM staff;', 'What does it return?',
            ['175.0', '116.67', '700', 'NULL'], 0),
    predict('c-predict-inner-join', 2, ['join'], 'Boxes and Owners',
            'SELECT s.name, b.size FROM staff s JOIN boxes b ON b.owner_id = s.id;',
            'How many rows does it return?', ['3', '4', '6', '7'], 0, base=STAFF_BOXES),
    predict('c-predict-left-join', 2, ['left-join'], 'Everyone and Their Boxes',
            'SELECT s.name, b.size FROM staff s LEFT JOIN boxes b ON b.owner_id = s.id;',
            'How many rows does it return?', ['7', '6', '3', '10'], 0, base=STAFF_BOXES),
    predict('c-predict-order-limit', 1, ['order-by', 'limit'], 'Top Two',
            'SELECT name FROM staff ORDER BY salary DESC, name LIMIT 2;', 'Which names, in order?',
            ['Cy, Ana', 'Cy, Fay', 'Ana, Fay', 'Eli, Ben'], 0),
    predict('c-predict-having', 2, ['having', 'group-by'], 'Departments That Stay',
            'SELECT dept FROM staff GROUP BY dept HAVING COUNT(*) >= 2;', 'Which departments?',
            ['Vault, Teller', 'Vault', 'Vault, Teller, Audit', 'Audit'], 0),
    predict('c-predict-case', 2, ['case'], 'Label for Di',
            "SELECT name, CASE WHEN bonus IS NULL THEN 'none' WHEN bonus >= 200 THEN 'big' ELSE 'small' END AS b FROM staff;",
            'What is `b` for Di, and for Cy?', ['none, small', 'small, small', 'none, big', 'NULL, small'], 0),
    predict('c-predict-union', 2, ['union'], 'Combine the Departments',
            "SELECT dept FROM staff WHERE salary > 5000 UNION SELECT dept FROM staff WHERE bonus = 100;",
            'How many rows?', ['2', '5', '4', '3'], 0),
    predict('c-predict-row-number', 3, ['row-number', 'window'], 'Who Is First',
            'SELECT name, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC, name) AS n FROM staff;',
            'Which names get `n = 1`?', ['Cy, Ben, Di', 'Ana, Ben, Di', 'Cy, Eli, Di', 'Cy only'], 0),
    predict('c-predict-concat-null', 2, ['string', 'null', 'coalesce'], 'Hello Bonus',
            "SELECT name || ': ' || bonus FROM staff WHERE id IN (1, 2);", 'What are the two rows?',
            ["'Ana: 300' and NULL", "'Ana: 300' and 'Ben: '", "'Ana: 300' and 'Ben: NULL'", 'NULL and NULL'], 0),
    predict('c-predict-int-division', 2, ['scalar'], 'Halves',
            'SELECT 7 / 2, 7 / 2.0;', 'What does SQLite return?',
            ['3, 3.5', '3.5, 3.5', '3, 3', '4, 3.5'], 0),
    predict('c-predict-rank', 3, ['rank', 'window'], 'Ranks with a Tie',
            'SELECT name, RANK() OVER (ORDER BY salary DESC) AS r FROM staff WHERE dept = \'Vault\';',
            'What ranks do Cy, Ana and Fay get?', ['1, 2, 2', '1, 2, 3', '1, 1, 2', '1, 2, 4'], 0),
]

# --- 17.4 Explain the error -------------------------------------------------------------------

def error(slug, tier, topic, title, sql, options, correct=0, base=STAFF):
    return q(slug, tier, topic, title, 'C', 'analyze',
             'A teammate ran this query and got the error shown. Why?', base,
             choice([part('What is the cause?', options, correct)], show_sql=sql, show='error'))

errors = [
    error('c-error-typo-column', 1, ['select'], 'No Such Column',
          'SELECT nmae FROM staff;',
          ['The column name is misspelt: the table has `name`', 'The table `staff` does not exist',
           'SELECT needs a WHERE clause', 'Column names must be in quotes']),
    error('c-error-ambiguous', 2, ['join'], 'Which id?',
          'SELECT id, size FROM staff JOIN boxes ON boxes.owner_id = staff.id;',
          ['Both tables have an `id` column: say which one (`staff.id`)', 'JOIN needs the word INNER',
           '`size` is a reserved word', 'The ON condition is the wrong way round'], base=STAFF_BOXES),
    error('c-error-aggregate-in-where', 2, ['having', 'aggregate'], 'Counting Too Early',
          'SELECT dept FROM staff WHERE COUNT(*) > 1 GROUP BY dept;',
          ['WHERE runs before grouping, so it cannot use COUNT(); use HAVING', 'COUNT(*) needs a column name',
           'GROUP BY must come before WHERE', 'dept must also be counted']),
    error('c-error-trailing-comma', 1, ['select'], 'Stray Comma',
          'SELECT name, salary, FROM staff;',
          ['There is a comma after the last column', 'FROM must be lower case',
           'salary is not a column', 'Two columns need brackets']),
    error('c-error-unquoted-string', 1, ['where', 'text'], 'Vault Without Quotes',
          'SELECT name FROM staff WHERE dept = Vault;',
          ["Text values need single quotes ('Vault'); without them Vault is read as a column name",
           'There is no department called Vault', 'Use LIKE instead of =', 'dept must be in double quotes']),
    error('c-error-window-in-where', 3, ['window', 'row-number'], 'Numbering Too Early',
          'SELECT name FROM staff WHERE ROW_NUMBER() OVER (ORDER BY salary DESC) = 1;',
          ['Window functions are computed after WHERE: number the rows in a subquery or CTE, then filter',
           'ROW_NUMBER needs PARTITION BY', 'OVER needs a GROUP BY', 'Compare with == instead of =']),
    error('c-error-union-columns', 2, ['union'], 'Uneven Union',
          'SELECT name, dept FROM staff UNION SELECT name FROM staff WHERE bonus IS NULL;',
          ['Both sides of UNION must return the same number of columns', 'UNION cannot read one table twice',
           'IS NULL is not allowed after UNION', 'Use UNION ALL instead']),
    error('c-error-order-before-union', 3, ['union', 'order-by'], 'Sort in the Middle',
          'SELECT name FROM staff WHERE dept = \'Vault\' ORDER BY name UNION SELECT name FROM staff WHERE dept = \'Audit\';',
          ['ORDER BY may only come once, after the last SELECT of the UNION', 'UNION needs brackets around each side',
           'You cannot sort text', 'Audit has only one row']),
    error('c-error-subquery-columns', 2, ['in', 'subquery'], 'Too Many Columns',
          'SELECT name FROM staff WHERE id IN (SELECT owner_id, size FROM boxes);',
          ['`IN (subquery)` needs the subquery to return exactly one column', 'IN only works with numbers',
           'boxes has no column owner_id', 'Subqueries need an alias'], base=STAFF_BOXES),
    error('c-error-no-function', 1, ['string'], 'Length of a Name',
          'SELECT name, LEN(name) FROM staff;',
          ['SQLite has no LEN(); its function is length()', 'name must be in quotes',
           'Functions are not allowed in SELECT', 'The staff table has no name column']),
]

# --- 17.5 Read the plan -----------------------------------------------------------------------

def plan(slug, tier, topic, title, sql, parts, base=BANK_IX):
    return q(slug, tier, topic, title, 'C', 'analyze',
             'This is how SQLite plans to run the query (`EXPLAIN QUERY PLAN`). Read the plan.', base,
             choice(parts, show_sql=sql, show='plan'))

NO_IX = {'schema_sql': BANK_SCHEMA, 'data_gen': BANK_DATA}

plans = [
    plan('c-plan-scan', 3, ['index'], 'Every Row', "SELECT * FROM accounts WHERE owner = 'Ana';",
         [part('What does `SCAN accounts` mean?', ['SQLite reads every row of accounts',
                                                    'SQLite uses an index on owner', 'The query fails',
                                                    'Only one row is read'], 0),
          part('What would make it faster?', ['An index on `accounts(owner)`', 'An index on `accounts(balance)`',
                                               'Adding LIMIT 1000', 'Selecting fewer columns'], 0)], base=NO_IX),
    plan('c-plan-search-index', 3, ['index', 'where'], 'Index Used',
         "SELECT * FROM accounts WHERE branch = 'North';",
         [part('Does this plan use an index, and on what?', ['Yes, `accounts_branch` on branch',
                                                            'No, it reads every row',
                                                            'Yes, the primary key', 'Yes, on owner'], 0)]),
    plan('c-plan-temp-btree-order', 3, ['order-by', 'index'], 'The Extra Step',
         'SELECT owner, opened FROM accounts ORDER BY opened;',
         [part('What is `USE TEMP B-TREE FOR ORDER BY`?', ['An extra sorting step, because no index gives rows in that order',
                                                          'A permanent index SQLite created', 'An error in the plan',
                                                          'A join with another table'], 0)]),
    plan('c-plan-automatic-index', 4, ['index', 'self-join'], 'Built on the Fly',
         'SELECT a.id, b.id FROM accounts a JOIN accounts b ON b.owner = a.owner AND b.id <> a.id;',
         [part('What does `AUTOMATIC` mean in this plan?', ['SQLite builds a temporary index just for this query, because none exists',
                                                            'The query uses the primary key', 'The join is cached from before',
                                                            'Rows are read in random order'], 0),
          part('Which permanent index would help?', ['`accounts(owner)`', '`transactions(account_id)`',
                                                     '`accounts(balance)`', '`accounts(branch)`'], 0)], base=NO_IX),
    plan('c-plan-primary-key', 3, ['index'], 'Straight to the Row', 'SELECT * FROM accounts WHERE id = 42;',
         [part('Roughly how many rows does SQLite look at?', ['One: it jumps to the row by its key',
                                                             'All of them', 'Half of them', 'None'], 0)]),
    plan('c-plan-group-temp', 4, ['group-by', 'index'], 'Grouping Cost',
         'SELECT opened, COUNT(*) FROM accounts GROUP BY opened;',
         [part('What does the plan tell you?', ['Rows are read in full and sorted into groups with a temporary B-tree',
                                                 'An index on opened is used to group', 'Only one row per group is read',
                                                 'The GROUP BY is ignored'], 0)]),
    plan('c-plan-correlated', 4, ['correlated-subquery', 'index'], 'Once per Row',
         'SELECT owner, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS n FROM accounts a;',
         [part('What does `CORRELATED SCALAR SUBQUERY` mean?', ['The subquery runs again for each account row',
                                                              'The subquery runs once in total', 'It is a syntax error',
                                                              'The two tables are merged first'], 0),
          part('Why is it still fast enough here?', ['Each run is a SEARCH using the index on account_id',
                                                     'SQLite caches the whole table', 'COUNT(*) is free',
                                                     'The accounts table is empty'], 0)]),
    plan('c-plan-function-on-column', 4, ['index', 'string'], 'Index Ignored',
         "SELECT * FROM accounts WHERE lower(owner) = 'ana';",
         [part('There is an index on owner. Why does the plan still SCAN?', ['The index stores owner, not lower(owner): a function on the column hides it',
                                                                               'Indexes never work with text', 'The table is too small',
                                                                               'lower() is not allowed in WHERE'], 0)]),
    plan('c-plan-covering', 4, ['index'], 'Never Touches the Table',
         "SELECT branch FROM accounts WHERE branch = 'East';",
         [part('What does `COVERING INDEX` mean?', ['Every column the query needs is in the index, so table rows are never read',
                                                    'The index covers every table', 'The index is rebuilt', 'The table is locked'], 0)]),
    plan('c-plan-range', 3, ['index', 'between'], 'A Range Search', 'SELECT owner FROM accounts WHERE balance > 15000;',
         [part('What does `(balance>?)` tell you?', ['The index on balance is used to start at 15000 and read upwards',
                                                     'Every balance is compared one by one', 'balance must be unique',
                                                     'The query has a parameter error'], 0)]),
]

# --- 17.6 Fix the query -----------------------------------------------------------------------

P_BRANCH = {'branch': {'kind': 'pick', 'from': BRANCHES}}
P_MIN = {'min_balance': {'kind': 'int', 'min': 4000, 'max': 12000, 'step': 500}}
P_HIGH = {'min_balance': {'kind': 'int', 'min': 10000, 'max': 16000, 'step': 500}}


def fix(slug, tier, topic, title, story, broken, reference, params=None, base=BANK, hints=(), **extra):
    return q(slug, tier, topic, title, 'S', 'apply', story, base,
             {'kind': 'fix', 'broken_sql': broken}, reference, hints, params, **extra)

fixes = [
    fix('s-fix-quotes', 1, ['where', 'text'], 'Branch Without Quotes',
        'Return the **owner** of every account at the **{branch}** branch. The query below fails: fix it.',
        'SELECT owner FROM accounts WHERE branch = {branch};',
        'SELECT owner FROM accounts WHERE branch = {branch|sql};', P_BRANCH,
        hints=['Text values need single quotes.']),
    fix('s-fix-having', 2, ['having', 'group-by'], 'Busy Accounts',
        'Return **account_id** and the number of transactions for accounts with **more than one** transaction.',
        'SELECT account_id, COUNT(*) FROM transactions WHERE COUNT(*) > 1 GROUP BY account_id;',
        'SELECT account_id, COUNT(*) FROM transactions GROUP BY account_id HAVING COUNT(*) > 1;',
        hints=['Conditions on COUNT() go in HAVING, after GROUP BY.']),
    fix('s-fix-join-key', 2, ['join'], 'Wrong Match',
        'Return each transaction\'s **id**, **amount** and the account **owner**. The join pairs the wrong rows.',
        'SELECT t.id, t.amount, a.owner FROM transactions t JOIN accounts a ON a.id = t.id;',
        'SELECT t.id, t.amount, a.owner FROM transactions t JOIN accounts a ON a.id = t.account_id;',
        hints=['Which column of transactions points at an account?']),
    fix('s-fix-null', 1, ['null'], 'Who Has No Manager',
        'Return the **name** of every employee without a manager. The query returns nothing: fix it.',
        'SELECT name FROM employees WHERE manager_id = NULL;',
        'SELECT name FROM employees WHERE manager_id IS NULL;', base=EMP,
        hints=['Nothing is equal to NULL, not even NULL.']),
    fix('s-fix-precedence', 2, ['and', 'or'], 'Rich in Two Branches',
        'Return **id** and **owner** of accounts in **North** or **South** with a balance over **{min_balance}**. The query lets poor North accounts through.',
        'SELECT id, owner FROM accounts WHERE branch = \'North\' OR branch = \'South\' AND balance > {min_balance};',
        'SELECT id, owner FROM accounts WHERE (branch = \'North\' OR branch = \'South\') AND balance > {min_balance};',
        P_HIGH, allow_empty=True, hints=['AND binds tighter than OR.']),
    fix('s-fix-int-average', 2, ['avg', 'aggregate'], 'Average Balance per Branch',
        'Return each **branch** and its **average balance**, with decimals. The query rounds down.',
        'SELECT branch, SUM(balance) / COUNT(*) FROM accounts GROUP BY branch;',
        'SELECT branch, AVG(balance) FROM accounts GROUP BY branch;',
        hints=['Integer divided by integer is an integer in SQLite.']),
    fix('s-fix-left-join-where', 3, ['left-join', 'count'], 'Deposits per Account',
        'For **every** account return **id** and how many deposits (amount > 0) it has, including accounts with 0. Some accounts go missing.',
        'SELECT a.id, COUNT(t.id) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id WHERE t.amount > 0 GROUP BY a.id;',
        'SELECT a.id, COUNT(t.id) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.amount > 0 GROUP BY a.id;',
        hints=['A WHERE on the right table throws away the rows the LEFT JOIN kept.']),
    fix('s-fix-count-star-left', 3, ['left-join', 'count'], 'Zero Is Not One',
        'For every account return **id** and its number of transactions. Accounts with none should show **0**.',
        'SELECT a.id, COUNT(*) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;',
        'SELECT a.id, COUNT(t.id) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;',
        hints=['COUNT(*) counts the NULL row a LEFT JOIN adds; count a column of transactions.']),
    fix('s-fix-distinct', 1, ['distinct'], 'Branch List',
        'Return each **branch** that has an account, **once**.',
        'SELECT branch FROM accounts;', 'SELECT DISTINCT branch FROM accounts;'),
    fix('s-fix-order-direction', 1, ['order-by', 'top-n'], 'The Three Richest',
        'Return **id** and **balance** of the three accounts with the **highest** balance (ties: lowest id first), richest first.',
        'SELECT id, balance FROM accounts ORDER BY balance, id LIMIT 3;',
        'SELECT id, balance FROM accounts ORDER BY balance DESC, id LIMIT 3;', order_matters=True),
]

# --- 17.7 Make it faster ----------------------------------------------------------------------

def faster(slug, tier, topic, title, story, slow, reference, max_scans=0, params=None, hints=(), **extra):
    return q(slug, tier, topic, title, 'S', 'apply', story, BANK_IX,
             {'kind': 'faster', 'slow_sql': slow, 'max_scans': max_scans}, reference, hints, params, **extra)

P_OWNER = {'owner': {'kind': 'pick', 'from': OWNERS}}
P_YEAR = {'year': {'kind': 'pick', 'from': [2023, 2024, 2025]}}
P_ID = {'acc': {'kind': 'int', 'min': 2, 'max': 38}}
P_MONTH = {'month': {'kind': 'pick', 'from': [f'{y}-{m:02d}' for y in (2023, 2024, 2025) for m in range(1, 13)]}}

fasters = [
    faster('s-faster-function', 3, ['index', 'where'], 'Name Lookup',
           'Return **id** and **balance** of accounts owned by **{owner}**. Make the slow query use the index on owner.',
           'SELECT id, balance FROM accounts WHERE lower(owner) = lower({owner|sql});',
           'SELECT id, balance FROM accounts WHERE owner = {owner|sql};', params=P_OWNER, allow_empty=True,
           hints=['A function around the column hides it from its index.']),
    faster('s-faster-arithmetic', 3, ['index', 'where'], 'Rich Accounts Fast',
           'Return **id** of accounts with a balance over **{min_balance}**, using the index on balance.',
           'SELECT id FROM accounts WHERE balance + 0 > {min_balance};',
           'SELECT id FROM accounts WHERE balance > {min_balance};', params=P_MIN),
    faster('s-faster-year', 4, ['index', 'dates'], 'One Year of Activity',
           'Return **id** and **amount** of transactions in **{year}**, using the index on `at`.',
           "SELECT id, amount FROM transactions WHERE strftime('%Y', at) = '{year}';",
           "SELECT id, amount FROM transactions WHERE at BETWEEN '{year}-01-01' AND '{year}-12-31';",
           params=P_YEAR, hints=["Compare `at` itself with the year's first and last day."]),
    faster('s-faster-cast', 3, ['index', 'where'], 'Branch Lookup',
           'Return **owner** of accounts at **{branch}**, using the index on branch.',
           "SELECT owner FROM accounts WHERE branch || '' = {branch|sql};",
           'SELECT owner FROM accounts WHERE branch = {branch|sql};', params=P_BRANCH),
    faster('s-faster-coalesce', 3, ['index', 'coalesce'], 'Nothing Is Missing',
           'Return **id** of accounts at **{branch}**. No branch is ever NULL, so COALESCE only slows it down.',
           "SELECT id FROM accounts WHERE coalesce(branch, '?') = {branch|sql};",
           'SELECT id FROM accounts WHERE branch = {branch|sql};', params=P_BRANCH),
    faster('s-faster-month', 3, ['index', 'dates'], 'One Month',
           'Return **id** and **amount** of transactions in **{month}** (dates look like 2024-03-15), using the index on `at`.',
           "SELECT id, amount FROM transactions WHERE substr(at, 1, 7) = '{month}';",
           "SELECT id, amount FROM transactions WHERE at BETWEEN '{month}-01' AND '{month}-31';",
           params=P_MONTH, allow_empty=True),
    faster('s-faster-rowid', 2, ['index'], 'By Its Number',
           'Return **id**, **owner** and **balance** of the account whose id is one more than **{acc}**, without scanning.',
           'SELECT id, owner, balance FROM accounts WHERE id - 1 = {acc};',
           'SELECT id, owner, balance FROM accounts WHERE id = {acc} + 1;', params=P_ID),
    faster('s-faster-max', 3, ['index', 'min-max'], 'The Largest Under a Cap',
           'Return the **largest balance** that is at most **{cap}**. Let the index on balance answer it.',
           'SELECT balance FROM accounts WHERE balance + 0 <= {cap} ORDER BY balance DESC LIMIT 1;',
           'SELECT MAX(balance) FROM accounts WHERE balance <= {cap};',
           params={'cap': {'kind': 'int', 'min': 5000, 'max': 18000, 'step': 1}}),
    faster('s-faster-correlated', 4, ['index', 'correlated-subquery'], 'Count per Account',
           'Return each account **id** and its number of transactions. One full pass over accounts is fine; the counting must use the index on account_id.',
           'SELECT a.id, (SELECT COUNT(*) FROM transactions t WHERE t.account_id + 0 = a.id) FROM accounts a;',
           'SELECT a.id, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) FROM accounts a;',
           max_scans=1),
    faster('s-faster-join', 4, ['index', 'join'], 'Money at a Branch',
           'Return **t.id** and **t.amount** of transactions on accounts at **{branch}**. Read only the accounts of that branch and find their transactions through the index.',
           "SELECT t.id, t.amount FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.branch || '' = {branch|sql};",
           'SELECT t.id, t.amount FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.branch = {branch|sql};',
           params=P_BRANCH),
]

# --- 17.8 Write to the database ---------------------------------------------------------------

def write(slug, tier, topic, title, story, reference, check, params=None, base=BANK, hints=(), **extra):
    return q(slug, tier, topic, title, 'S', 'apply', story, base,
             {'kind': 'write_db', 'check_sql': check}, reference, hints, params, **extra)

ACC_CHECK = 'SELECT id, owner, branch, balance FROM accounts'
P_AMOUNT = {'amount': {'kind': 'int', 'min': 100, 'max': 900, 'step': 50}}

writes = [
    write('s-write-insert', 1, ['insert'], 'Open an Account',
          'Open a new account: id **1000**, owner **{owner}**, branch **{branch}**, balance **0**, opened **2026-01-01**.',
          "INSERT INTO accounts (id, owner, branch, balance, opened) VALUES (1000, {owner|sql}, {branch|sql}, 0, '2026-01-01');",
          ACC_CHECK, {**P_OWNER, **P_BRANCH}),
    write('s-write-update-branch', 1, ['update', 'where'], 'Branch Bonus',
          'Add **{amount}** to the balance of every account at **{branch}**. Leave the others alone.',
          'UPDATE accounts SET balance = balance + {amount} WHERE branch = {branch|sql};',
          ACC_CHECK, {**P_AMOUNT, **P_BRANCH}),
    write('s-write-delete', 1, ['delete', 'where'], 'Shred the Small Ones',
          'Delete every transaction with an amount between **-{amount}** and **{amount}** (inclusive).',
          'DELETE FROM transactions WHERE amount BETWEEN -{amount} AND {amount};',
          'SELECT id FROM transactions', P_AMOUNT),
    write('s-write-update-subquery', 2, ['update', 'subquery'], 'Mark the Silent',
          'Set the balance to **0** for every account that has **no transactions** at all.',
          'UPDATE accounts SET balance = 0 WHERE id NOT IN (SELECT account_id FROM transactions);',
          ACC_CHECK),
    write('s-write-create-as', 2, ['create-table'], 'A VIP List',
          'Create a table **vip** with the **id** and **owner** of every account with a balance over **{min_balance}**.',
          'CREATE TABLE vip AS SELECT id, owner FROM accounts WHERE balance > {min_balance};',
          'SELECT id, owner FROM vip', P_MIN),
    write('s-write-transfer', 2, ['update'], 'Move the Money',
          'Move **{amount}** from account **1** to account **2**: account 1 loses it, account 2 gains it.',
          'UPDATE accounts SET balance = balance - {amount} WHERE id = 1; UPDATE accounts SET balance = balance + {amount} WHERE id = 2;',
          ACC_CHECK, P_AMOUNT, hints=['Two UPDATE statements, one per account.']),
    write('s-write-insert-many', 2, ['insert'], 'Log Three Deposits',
          'Record three deposits of **{amount}** each on **2026-01-02** for accounts **1**, **2** and **3** (ids 9001, 9002, 9003).',
          "INSERT INTO transactions (id, account_id, amount, at) VALUES (9001, 1, {amount}, '2026-01-02'), (9002, 2, {amount}, '2026-01-02'), (9003, 3, {amount}, '2026-01-02');",
          'SELECT id, account_id, amount, at FROM transactions', P_AMOUNT),
    write('s-write-update-case', 3, ['update', 'case'], 'Fees and Gifts',
          'In one go: accounts under **1000** get **+100**; accounts over **15000** pay a fee of **50**. Others stay the same.',
          'UPDATE accounts SET balance = CASE WHEN balance < 1000 THEN balance + 100 WHEN balance > 15000 THEN balance - 50 ELSE balance END;',
          ACC_CHECK),
    write('s-write-delete-subquery', 3, ['delete', 'subquery'], 'Close Empty Accounts',
          'Delete the accounts at **{branch}** that have **no transactions**.',
          'DELETE FROM accounts WHERE branch = {branch|sql} AND id NOT IN (SELECT account_id FROM transactions);',
          ACC_CHECK, P_BRANCH),
    write('s-write-create-insert', 3, ['create-table', 'insert', 'group-by'], 'Branch Totals Table',
          'Create a table **branch_totals (branch, total)** and fill it with each branch and the sum of its balances.',
          'CREATE TABLE branch_totals (branch TEXT, total INTEGER); INSERT INTO branch_totals SELECT branch, SUM(balance) FROM accounts GROUP BY branch;',
          'SELECT branch, total FROM branch_totals'),
]

# --- 17.9 Choose and defend -------------------------------------------------------------------

def defend(slug, tier, topic, title, constraint, queries, pick, reasons, right_reason, base=BANK, n=2):
    sql = '\n\n'.join(f'-- Query {chr(65 + i)}\n{s}' for i, s in enumerate(queries))
    names = [f'Query {chr(65 + i)}' for i in range(len(queries))]
    return q(slug, tier, topic, title, 'E', 'evaluate',
             f'Both queries run. **{constraint}** Choose one and say why.', base,
             choice([part('Which query should you use?', names, pick),
                     part('Why?', reasons, right_reason, weight=2)],
                    show_sql=sql, pass_share=0.6, shuffle=True))

# --- 17.13 Coverage: fill the tier × RCSBE / Bloom cells that were empty --------------------------

coverage = [
    # Tier 1 × Evaluate
    defend('e-defend-named-columns', 1, ['select'], 'Only What the Report Needs',
           'A weekly report needs each owner and balance. The table will get more columns next term.',
           ['SELECT * FROM accounts;', 'SELECT owner, balance FROM accounts;'], 1,
           ['B names exactly what the report needs, so it stays the same when columns are added',
            '`*` is not allowed in reports', 'A returns fewer rows than B', 'B is the only one that runs'], 0),
    defend('e-defend-let-sql-count', 1, ['group-by', 'count'], 'Count per Branch',
           'The crew needs how many accounts each branch has, one line per branch.',
           ['SELECT branch FROM accounts ORDER BY branch;  -- then count the lines by hand',
            'SELECT branch, COUNT(*) FROM accounts GROUP BY branch;'], 1,
           ['GROUP BY makes one row per branch and the database does the counting, so nothing is miscounted',
            'ORDER BY cannot be used on text', 'A returns more columns', 'COUNT(*) only works with WHERE'], 0),
    # Tier 4 × Recall
    q('r-fill-partition', 4, ['window', 'running-total'], 'Totals per Department', 'R', 'remember',
      'Fill the blank so each department gets its own running total.', EMP,
      fill('SELECT name, SUM(salary) OVER (___ BY dept ORDER BY id) AS running FROM employees;', ['PARTITION'])),
    q('r-fill-frame', 4, ['window', 'range', 'running-total'], 'From the Start to Here', 'R', 'remember',
      'Fill the blanks: the frame runs from the first row up to the current one.', BANK,
      fill('SELECT id, SUM(amount) OVER (ORDER BY at, id ROWS BETWEEN ___ PRECEDING AND ___ ROW) FROM transactions;',
           ['UNBOUNDED'], ['CURRENT'])),
    # Tier 5 × Recall
    q('r-fill-recursive', 5, ['recursive-cte'], 'Down the Chain', 'R', 'remember',
      'Fill the blanks to walk down the management chain from the people with no manager.', EMP,
      fill('WITH ___ chain(id) AS (SELECT id FROM employees WHERE manager_id IS NULL ___ SELECT e.id FROM employees e JOIN chain c ON e.manager_id = c.id) SELECT COUNT(*) FROM chain;',
           ['RECURSIVE'], ['UNION ALL', 'UNION'])),
    q('r-choice-recursion-stop', 5, ['recursive-cte'], 'When It Stops', 'R', 'remember',
      'Quick check.', EMP,
      choice([part('When does a recursive CTE stop?',
                   ['When its recursive part returns no new rows', 'After exactly 100 steps',
                    'When it reaches LIMIT', 'When the first row repeats'], 0)])),
    # Tier 4 × Comprehend (understand)
    predict('c-predict-running-sum', 4, ['window', 'running-total'], 'Running Pay',
            "SELECT name, SUM(salary) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS run FROM staff WHERE dept = 'Vault';",
            'What is `run` for Fay?', ['16500', '5200', '11300', '15600'], 0),
    predict('c-predict-lag', 4, ['lag', 'window'], 'The Row Before',
            'SELECT name, LAG(salary) OVER (ORDER BY id) AS prev FROM staff;',
            'What is `prev` for Ana, and for Cy?', ['NULL, 3100', '0, 3100', '3100, 5200', 'NULL, 5200'], 0),
    # Tier 5 × Comprehend (understand)
    predict('c-predict-recursive', 5, ['recursive-cte'], 'Doubling',
            'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x * 2 FROM n WHERE x < 20) SELECT MAX(x), COUNT(*) FROM n;',
            'What does it return?', ['32, 6', '16, 5', '20, 5', '32, 5'], 0),
    predict('c-predict-ntile', 5, ['ntile', 'window'], 'Four Buckets',
            'SELECT name, NTILE(4) OVER (ORDER BY salary DESC, name) AS q FROM staff;',
            'Which bucket are Fay and Eli in?', ['2, 4', '1, 4', '2, 3', '3, 4'], 0),
]

# The first part's options ("Query A", "Query B") must keep their order; reasons are shuffled.
defends = [
    defend('e-defend-not-exists', 4, ['not-exists', 'not-in', 'null'], 'Missing Owners',
           'Find staff with no box. `boxes.owner_id` can be NULL.',
           ['SELECT name FROM staff WHERE id NOT IN (SELECT owner_id FROM boxes);',
            'SELECT name FROM staff s WHERE NOT EXISTS (SELECT 1 FROM boxes b WHERE b.owner_id = s.id);'], 1,
           ['If the subquery returns a NULL, NOT IN is never true, so A returns nothing',
            'NOT EXISTS is always faster', 'NOT IN cannot use a subquery', 'A returns duplicates'], 0, base=STAFF_BOXES),
    defend('e-defend-count-column', 3, ['left-join', 'count'], 'Zero Means Zero',
           'Every account must show its transaction count, 0 when it has none.',
           ['SELECT a.id, COUNT(*) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;',
            'SELECT a.id, COUNT(t.id) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;'], 1,
           ['COUNT(t.id) skips the NULL row the LEFT JOIN adds; COUNT(*) counts it as 1',
            'COUNT(*) is not allowed with GROUP BY', 'B is faster because it reads fewer columns',
            'A drops accounts without transactions'], 0),
    defend('e-defend-window-total', 4, ['window', 'group-by'], 'Row and Total',
           'Each transaction must be listed with its account\'s total next to it.',
           ['SELECT account_id, SUM(amount) FROM transactions GROUP BY account_id;',
            'SELECT id, account_id, amount, SUM(amount) OVER (PARTITION BY account_id) AS total FROM transactions;'], 1,
           ['A window keeps every row and adds the group total; GROUP BY collapses rows to one per account',
            'GROUP BY cannot SUM negative amounts', 'Windows are always faster than GROUP BY',
            'A sorts the rows differently'], 0),
    defend('e-defend-union-all', 3, ['union'], 'Every Movement',
           'Every deposit and every withdrawal must be listed, even two that look identical.',
           ['SELECT account_id, amount FROM transactions WHERE amount > 0 UNION SELECT account_id, amount FROM transactions WHERE amount < 0;',
            'SELECT account_id, amount FROM transactions WHERE amount > 0 UNION ALL SELECT account_id, amount FROM transactions WHERE amount < 0;'], 1,
           ['UNION removes identical rows (and sorts to find them); UNION ALL keeps them all',
            'UNION ALL removes NULLs', 'UNION cannot combine one table with itself', 'A returns more rows than B'], 0),
    defend('e-defend-row-number', 4, ['row-number', 'rank', 'top-n'], 'Exactly One Each',
           'Exactly one top earner per department is needed, even when two earn the same.',
           ["SELECT * FROM (SELECT name, dept, RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS r FROM employees) WHERE r = 1;",
            "SELECT * FROM (SELECT name, dept, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC, id) AS r FROM employees) WHERE r = 1;"], 1,
           ['RANK gives tied rows the same number, so A can return two people per department',
            'RANK skips departments with ties', 'ROW_NUMBER is the only function allowed in a subquery',
            'A is wrong because it has no tie-break, so it errors'], 0, base=EMP),
    defend('e-defend-sargable-date', 4, ['index', 'dates'], 'A Huge Table',
           'The transactions table has 50 million rows and an index on `at`. You need March 2025.',
           ["SELECT * FROM transactions WHERE strftime('%Y-%m', at) = '2025-03';",
            "SELECT * FROM transactions WHERE at >= '2025-03-01' AND at < '2025-04-01';"], 1,
           ['B compares the column itself, so the index on at can jump to March; A must compute strftime for every row',
            'strftime returns wrong months', 'B returns more rows', 'A cannot run on large tables'], 0, base=BANK_IX),
    defend('e-defend-cte', 3, ['cte', 'subquery'], 'Said Twice',
           'The same "big accounts" subquery is needed twice, and a teammate must be able to check it.',
           ['SELECT COUNT(*), (SELECT AVG(balance) FROM (SELECT * FROM accounts WHERE balance > 10000)) FROM (SELECT * FROM accounts WHERE balance > 10000);',
            'WITH big AS (SELECT * FROM accounts WHERE balance > 10000) SELECT COUNT(*), (SELECT AVG(balance) FROM big) FROM big;'], 1,
           ['The CTE defines the rule once, so it cannot drift between the two copies and is easier to read',
            'CTEs are the only way to use AVG', 'A returns a different count', 'Subqueries cannot be nested twice'], 0),
    defend('e-defend-where-not-having', 3, ['where', 'having', 'group-by'], 'Deposits Only',
           'Sum only the deposits (amount > 0) of each account.',
           ['SELECT account_id, SUM(amount) FROM transactions WHERE amount > 0 GROUP BY account_id;',
            'SELECT account_id, SUM(amount) FROM transactions GROUP BY account_id HAVING SUM(amount) > 0;'], 0,
           ['WHERE drops withdrawals before summing; HAVING only drops whole accounts after summing everything',
            'HAVING is slower but gives the same answer', 'WHERE cannot be used with GROUP BY',
            'B counts deposits twice'], 0),
    defend('e-defend-exists-distinct', 4, ['exists', 'join', 'distinct'], 'Who Moved Big Money',
           'List each owner with at least one transaction over 2000, once, on a large table.',
           ['SELECT DISTINCT a.id, a.owner FROM accounts a JOIN transactions t ON t.account_id = a.id WHERE t.amount > 2000;',
            'SELECT a.id, a.owner FROM accounts a WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id AND t.amount > 2000);'], 1,
           ['EXISTS stops at the first match and never makes duplicates; the join makes them and DISTINCT removes them again',
            'DISTINCT is not allowed with JOIN', 'EXISTS returns the amounts too', 'A misses owners with one transaction'], 0),
    defend('e-defend-join-vs-correlated', 4, ['correlated-subquery', 'join', 'group-by'], 'Totals Without an Index',
           'There is no index on `transactions.account_id`, and both tables are large.',
           ['SELECT a.id, (SELECT SUM(amount) FROM transactions t WHERE t.account_id = a.id) FROM accounts a;',
            'SELECT a.id, SUM(t.amount) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;'], 1,
           ['Without the index A reads all transactions once per account; B can do the work in one grouped pass',
            'A returns wrong totals', 'Subqueries are not allowed in SELECT', 'B drops accounts without transactions'], 0),
    defend('e-defend-order-limit', 2, ['limit', 'order-by'], 'The Five Newest',
           'Show the five newest transactions.',
           ['SELECT * FROM transactions LIMIT 5;', 'SELECT * FROM transactions ORDER BY at DESC, id DESC LIMIT 5;'], 1,
           ['Without ORDER BY the database may return any five rows; LIMIT alone does not mean newest',
            'LIMIT needs ORDER BY or it errors', 'A returns the oldest five', 'B returns more rows'], 0),
    defend('e-defend-avg', 2, ['avg', 'aggregate'], 'Fair Average',
           'The average balance must keep its decimals.',
           ['SELECT SUM(balance) / COUNT(*) FROM accounts;', 'SELECT AVG(balance) FROM accounts;'], 1,
           ['SUM / COUNT of integers is integer division in SQLite, which drops the decimals',
            'AVG skips zero balances', 'A counts NULL balances', 'B rounds to whole numbers'], 0),
    defend('e-defend-coalesce-sum', 3, ['coalesce', 'left-join', 'sum'], 'Nothing Is Zero',
           'Accounts without transactions must show a total of 0, not empty.',
           ['SELECT a.id, SUM(t.amount) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;',
            'SELECT a.id, COALESCE(SUM(t.amount), 0) FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id;'], 1,
           ['SUM over no rows is NULL; COALESCE turns it into 0', 'SUM ignores negative numbers',
            'A drops accounts without transactions', 'COALESCE makes the query faster'], 0),
    defend('e-defend-recursive', 5, ['recursive-cte', 'self-join'], 'How Deep Is the Chain',
           'Find everyone under employee 1, however many levels down the chain goes.',
           ['SELECT e2.name FROM employees e1 JOIN employees e2 ON e2.manager_id = e1.id WHERE e1.id = 1 UNION SELECT e3.name FROM employees e1 JOIN employees e2 ON e2.manager_id = e1.id JOIN employees e3 ON e3.manager_id = e2.id WHERE e1.id = 1;',
            'WITH RECURSIVE down(id, name) AS (SELECT id, name FROM employees WHERE manager_id = 1 UNION SELECT e.id, e.name FROM employees e JOIN down d ON e.manager_id = d.id) SELECT name FROM down;'], 1,
           ['The self-joins stop at a fixed depth (two levels); the recursive CTE follows the chain until it ends',
            'Self-joins cannot use UNION', 'The CTE is faster on every table', 'A counts employee 1 too'], 0, base=EMP),
    defend('e-defend-money-type', 3, ['aggregate'], 'Storing Money',
           'Balances must add up to the exact cent across millions of rows.',
           ['CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount REAL); -- euros, e.g. 10.10',
            'CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount_cents INTEGER); -- cents, e.g. 1010'], 1,
           ['REAL is binary floating point: 0.1 cannot be stored exactly, so sums drift; whole cents add up exactly',
            'INTEGER columns take less space, which is the only reason', 'REAL cannot be summed',
            'SQLite has no REAL type'], 0),
]

# Option order of "Which query" must stay A, B, so those parts are not shuffled: the task-level
# shuffle covers every part, so turn it off and shuffle the reasons here instead.
import random

for d in defends + [c for c in coverage if c['rcsbe'] == 'E']:
    d['task']['shuffle'] = False
    reasons = d['task']['parts'][1]
    rnd = random.Random(d['slug'])
    order = list(range(len(reasons['options'])))
    rnd.shuffle(order)
    right = reasons['correct'][0]
    reasons['options'] = [{'id': chr(97 + n), 'text_md': reasons['options'][i]['text_md']} for n, i in enumerate(order)]
    reasons['correct'] = [chr(97 + order.index(ord(right) - 97))]

# Recall/predict/error/plan options were written right-answer-first; the per-player shuffle
# hides that in the game, but the stored order should not give it away in the admin either.
for group in (recall, predicts, errors, plans, [c for c in coverage if c['rcsbe'] != 'E']):
    for question in group:
        task = question['task']
        if task['kind'] != 'choice':
            continue
        for p in task['parts']:
            rnd = random.Random(question['slug'] + p['prompt_md'])
            order = list(range(len(p['options'])))
            rnd.shuffle(order)
            right = {ord(c) - 97 for c in p['correct']}
            p['options'] = [{'id': chr(97 + n), 'text_md': p['options'][i]['text_md']} for n, i in enumerate(order)]
            p['correct'] = [chr(97 + n) for n, i in enumerate(order) if i in right]

# --- 17.10 Open briefs: planning the next heist between rounds -------------------------------

RUBRIC = [
    {'criterion': 'States a clear goal: what the crew needs to find out', 'marks': 2},
    {'criterion': 'Says when it is done (a check you could run)', 'marks': 2},
    {'criterion': 'The queries answer the goal and run', 'marks': 4},
    {'criterion': 'Shows how they know it worked (a check query or a count that matches)', 'marks': 2},
]


def brief(slug, tier, topic, title, story, base=BANK, rubric=RUBRIC):
    return q(slug, tier, topic, title, 'B', 'create', story, base, {'kind': 'brief', 'rubric': rubric})

briefs = [
    brief('b-plan-target-branch', 1, ['group-by', 'aggregate'], 'Pick the Target Branch',
          'Next round the crew hits **one branch**. Decide which branch is worth it and why, using `accounts`.\n\n'
          'Write your goal, when you are done, your queries (in the editor) and how you know your answer is right.'),
    brief('b-plan-quiet-accounts', 2, ['left-join', 'subquery'], 'Accounts Nobody Watches',
          'Accounts with little activity are less likely to be noticed. Find a way to list the **quietest accounts** and decide how many to target.'),
    brief('b-plan-cash-timing', 3, ['dates', 'group-by'], 'When Is the Cash In',
          'Look at `transactions` and decide **which month or weekday** the crew should strike, when deposits are highest. Say what "highest" means for you.'),
    brief('b-plan-inside-help', 2, ['self-join', 'where'], 'Find the Inside Help',
          'Using `employees`, find **who would make a good inside contact**: you choose the rule (department, pay, who they report to). Explain the rule and check it.',
          base=EMP),
    brief('b-plan-split-loot', 3, ['aggregate', 'case'], 'Split the Loot Fairly',
          'Propose a **fair split** of the money in the richest accounts between five crew roles. Write queries that compute each share and a check that the shares add up.'),
    brief('b-plan-risk-score', 4, ['case', 'window'], 'A Risk Score',
          'Build a **risk score** for each account (for example from balance and number of transactions) and rank the accounts by it. Explain your score and test it on two accounts by hand.'),
    brief('b-plan-cover-tracks', 4, ['update', 'delete'], 'Cover the Tracks (On Paper)',
          'Plan which rows would have to change to hide a withdrawal of 5000 from account 1. **Do not change anything:** write the SELECTs that find those rows, and say how you would check nothing else changed.'),
    brief('b-plan-full-heist', 5, ['cte', 'window', 'join'], 'The Full Plan',
          'Write the **whole plan** for the next heist: the target branch, the accounts, the timing and the split. Use CTEs so each step can be checked on its own, and end with one query that shows the plan.'),
]

# --- 17.12 Story themes: the bank questions also come as a casino --------------------------------

CASINO = {
    'name': 'casino',
    'tables': {'accounts': 'players', 'transactions': 'bets'},
    'columns': {'balance': 'chips', 'branch': 'floor', 'account_id': 'player_id'},
    'words': {
        'account': 'player', 'accounts': 'players', 'transaction': 'bet', 'transactions': 'bets',
        'branch': 'floor', 'branches': 'floors', 'balance': 'chips', 'balances': 'chips',
        'bank': 'casino', 'deposit': 'win', 'deposits': 'wins', 'withdrawal': 'loss', 'withdrawals': 'losses',
    },
}

for group in (recall, fixes, fasters, writes, defends, coverage):
    for question in group:
        if question['data_gen'] is BANK_DATA:
            question['themes'] = [CASINO]

FILES = {
    'kinds-recall.json': recall,
    'kinds-predict.json': predicts,
    'kinds-errors.json': errors,
    'kinds-plans.json': plans,
    'kinds-fix.json': fixes,
    'kinds-faster.json': fasters,
    'kinds-write.json': writes,
    'kinds-defend.json': defends,
    'kinds-briefs.json': briefs,
    'kinds-coverage.json': coverage,
}

for name, questions in FILES.items():
    (OUT / name).write_text(json.dumps({'format': 'heist-questions', 'version': 1, 'questions': questions},
                                       indent=2, ensure_ascii=False) + '\n')
    print(f'{name}: {len(questions)}')
