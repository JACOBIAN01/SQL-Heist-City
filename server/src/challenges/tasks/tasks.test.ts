import { describe, expect, it } from 'vitest';
import {
  addItem,
  emptyTotals,
  DEFAULT_ANALYTICS_SETTINGS,
  questionTemplateSchema,
  type ItemRecord,
} from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { StaticSettings } from '../../config/SettingsReader';
import { InMemoryQuestionRepository } from '../../questions/InMemoryQuestionRepository';
import { Grader } from '../../sql/Grader';
import { InProcessSandboxRunner } from '../../sql/SandboxRunner';
import { builtInDatasets } from '../../variants/datasets';
import { VariantBuilder } from '../../variants/VariantBuilder';
import { ChallengeService } from '../ChallengeService';
import { QuestionSelector } from '../QuestionSelector';

const fixed = {
  schema_sql:
    'CREATE TABLE accounts(id INTEGER PRIMARY KEY, owner TEXT, balance INTEGER); CREATE INDEX accounts_owner ON accounts(owner);',
  data_gen: {
    accounts: {
      rows: [20, 20],
      columns: {
        id: { kind: 'serial' },
        owner: { kind: 'pick', from: ['Ana', 'Ben', 'Cy', 'Di'] },
        balance: { kind: 'int', min: 0, max: 900, step: 100 },
      },
    },
  },
  params: {},
  story_md: 'The accounts table.',
  hints: [],
} as const;

function setup(over: Record<string, unknown>) {
  const repo = new InMemoryQuestionRepository();
  repo.create(questionTemplateSchema.parse({ ...sampleQuestion, ...over }), null);
  const items: ItemRecord[] = [];
  let clock = 1_000_000;
  const service = new ChallengeService({
    matchSeed: 'm',
    selector: new QuestionSelector(repo),
    variants: new VariantBuilder(builtInDatasets),
    grader: new Grader(new InProcessSandboxRunner()),
    settings: new StaticSettings(),
    now: () => (clock += 10_000),
    attempts: { event: () => {}, item: (i) => items.push(i) },
  });
  const issue = async (rewardKey = 'heal:small') => {
    const r = await service.issue({ player: 'p', rewardKey });
    if (!r.ok) throw new Error(r.reason);
    return r.challenge;
  };
  return { service, issue, items };
}

describe('task kinds', () => {
  it('fix: shows the broken query and grades the rows', async () => {
    const t = setup({
      ...fixed,
      topic: ['select'],
      reference_sql: 'SELECT owner FROM accounts WHERE balance > 500;',
      task: { kind: 'fix', broken_sql: 'SELECT owner FROM accounts WHERE balance > 500 GROUP;' },
    });
    const c = await t.issue();
    expect(c.task).toEqual({
      kind: 'fix',
      brokenSql: 'SELECT owner FROM accounts WHERE balance > 500 GROUP;',
    });
    expect(
      (await t.service.submit('p', c.id, 'SELECT owner FROM accounts WHERE balance > 500')).status,
    ).toBe('correct');
  });

  it('faster: right rows with a full scan is refused; using the index passes', async () => {
    const t = setup({
      ...fixed,
      reference_sql: "SELECT id FROM accounts WHERE owner = 'Ana';",
      task: {
        kind: 'faster',
        slow_sql: "SELECT id FROM accounts WHERE lower(owner) = 'ana';",
        max_scans: 0,
      },
    });
    let c = await t.issue();
    const slow = await t.service.submit(
      'p',
      c.id,
      "SELECT id FROM accounts WHERE owner || '' = 'Ana'",
    );
    expect(slow).toMatchObject({ status: 'wrong', feedback: { code: 'too_slow' } });
    c = await t.issue();
    expect(
      (await t.service.submit('p', c.id, "SELECT id FROM accounts WHERE owner = 'Ana'")).status,
    ).toBe('correct');
  });

  it('write_db: graded by the state the statements leave', async () => {
    const t = setup({
      ...fixed,
      reference_sql: "UPDATE accounts SET balance = 0 WHERE owner = 'Ben';",
      task: { kind: 'write_db', check_sql: 'SELECT id, balance FROM accounts' },
    });
    let c = await t.issue();
    expect(c.example).toBeUndefined();
    const wrong = await t.service.submit('p', c.id, 'UPDATE accounts SET balance = 0');
    expect(wrong.status).toBe('wrong');
    c = await t.issue();
    const right = await t.service.submit(
      'p',
      c.id,
      "UPDATE accounts SET balance = balance - balance WHERE owner = 'Ben'",
    );
    expect(right.status).toBe('correct');
  });

  const choice = {
    ...fixed,
    rcsbe: 'C',
    bloom: 'understand',
    reference_sql: '',
    task: {
      kind: 'choice',
      show_sql: 'SELECT COUNT(*) FROM accounts',
      show: 'result',
      parts: [
        {
          prompt_md: 'How many rows?',
          options: [
            { id: 'a', text_md: '20' },
            { id: 'b', text_md: '4' },
          ],
          correct: ['a'],
        },
        {
          prompt_md: 'Why?',
          options: [
            { id: 'x', text_md: 'one per row' },
            { id: 'y', text_md: 'one per owner' },
          ],
          correct: ['x'],
          weight: 3,
        },
      ],
      pass_share: 0.75,
      shuffle: false,
    },
  } as const;

  it('choice: shows the query result, never the answers; part marks pass at pass_share', async () => {
    const t = setup(choice);
    let c = await t.issue();
    expect(c.task).toMatchObject({ kind: 'choice', shown: { kind: 'result', rows: [[20]] } });
    expect(JSON.stringify(c)).not.toContain('correct');
    expect((await t.service.run('p', c.id, 'SELECT 1')).ok).toBe(false);
    // Reasons right, count wrong: 3 of 4 weight → passes, with share 0.75 on the record.
    const pass = await t.service.submit('p', c.id, '', { choices: [['2'], ['1']] });
    expect(pass.status).toBe('correct');
    expect(t.items.at(-1)).toMatchObject({ outcome: 'solved', share: 0.75 });
    c = await t.issue();
    const fail = await t.service.submit('p', c.id, '', { choices: [['1'], ['2']] });
    expect(fail).toMatchObject({ status: 'answered', share: 0.25 });
    expect(t.items.at(-1)).toMatchObject({ outcome: 'answered', share: 0.25 });
    // One go: the question is gone.
    expect((await t.service.submit('p', c.id, '', { choices: [['1'], ['1']] })).status).toBe(
      'rejected',
    );
  });

  it('choice: each player sees the options in their own order, under positional ids', async () => {
    const t = setup({ ...choice, task: { ...choice.task, shuffle: true } });
    const orders = new Set<string>();
    for (let n = 0; n < 8; n++) {
      const c = await t.issue();
      const task = c.task as Extract<typeof c.task, { kind: 'choice' }>;
      expect(task.parts[0]?.options.map((o) => o.id)).toEqual(['1', '2']);
      orders.add(task.parts.map((p) => p.options.map((o) => o.text).join()).join('|'));
      // Whatever the order, picking the right texts is right.
      const pick = (part: number, text: string) => [
        task.parts[part]?.options.find((o) => o.text === text)?.id ?? '',
      ];
      const r = await t.service.submit('p', c.id, '', {
        choices: [pick(0, '20'), pick(1, 'one per row')],
      });
      expect(r.status).toBe('correct');
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('choice: tables are shown in full (up to the example size), since the answer comes from them', async () => {
    const c = await setup(choice).issue();
    expect(c.tables[0]?.sampleRows).toHaveLength(10);
    const w = await setup({ ...fixed, reference_sql: 'SELECT id FROM accounts' }).issue();
    expect(w.tables[0]?.sampleRows).toHaveLength(3);
  });

  it('fill: blanks ignore case and spaces', async () => {
    const t = setup({
      ...fixed,
      rcsbe: 'R',
      bloom: 'remember',
      reference_sql: '',
      task: {
        kind: 'fill',
        text_sql: 'SELECT owner, ___(*) FROM accounts ___ owner',
        blanks: [{ accept: ['COUNT'] }, { accept: ['GROUP BY'] }],
      },
    });
    const c = await t.issue();
    expect(c.task).toEqual({
      kind: 'fill',
      textSql: 'SELECT owner, ___(*) FROM accounts ___ owner',
      blanks: 2,
    });
    expect(
      (await t.service.submit('p', c.id, '', { blanks: ['count', ' group   by '] })).status,
    ).toBe('correct');
  });

  it('brief: handed in, counted later', async () => {
    const t = setup({
      ...fixed,
      rcsbe: 'B',
      bloom: 'create',
      reference_sql: '',
      task: { kind: 'brief', rubric: [{ criterion: 'States a goal', marks: 2 }] },
    });
    const c = await t.issue('brief:plan');
    expect((await t.service.submit('p', c.id, '', { text: 'short' })).status).toBe('wrong');
    expect(
      (
        await t.service.submit('p', c.id, '', {
          text: 'Goal: find big balances. Done when every row is over 500.',
        })
      ).status,
    ).toBe('received');
    expect(t.items.at(-1)?.outcome).toBe('submitted');
    expect(
      addItem(emptyTotals(), t.items.at(-1) as ItemRecord, DEFAULT_ANALYTICS_SETTINGS).rcsbe.B
        .available,
    ).toBe(0);
  });

  it('briefs only come up for planning, and planning only asks briefs', async () => {
    const repo = new InMemoryQuestionRepository();
    repo.create(
      questionTemplateSchema.parse({
        ...sampleQuestion,
        ...fixed,
        reference_sql: 'SELECT id FROM accounts',
      }),
      null,
    );
    repo.create(
      questionTemplateSchema.parse({
        ...sampleQuestion,
        ...fixed,
        slug: 'plan',
        rcsbe: 'B',
        bloom: 'create',
        reference_sql: '',
        task: {
          kind: 'brief',
          rubric: [
            { criterion: 'Goal', marks: 2 },
            { criterion: 'Check', marks: 3 },
          ],
        },
      }),
      null,
    );
    const items: ItemRecord[] = [];
    let clock = 0;
    const service = new ChallengeService({
      matchSeed: 'm',
      selector: new QuestionSelector(repo),
      variants: new VariantBuilder(builtInDatasets),
      grader: new Grader(new InProcessSandboxRunner()),
      settings: new StaticSettings(),
      now: () => (clock += 10_000),
      attempts: { event: () => {}, item: (i) => items.push(i) },
    });
    for (let n = 0; n < 6; n++) {
      const r = await service.issue({ player: 'p', rewardKey: 'heal:small' });
      expect(r.ok ? r.challenge.task : 'none').toBeUndefined();
    }
    const plan = await service.issue({ player: 'p', rewardKey: 'brief:plan' });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.challenge.task?.kind).toBe('brief');
    await service.run('p', plan.challenge.id, 'SELECT COUNT(*) FROM accounts');
    const text = 'Goal: count accounts. Done when the number matches the table.';
    expect(
      (await service.submit('p', plan.challenge.id, 'SELECT COUNT(*) FROM accounts', { text }))
        .status,
    ).toBe('received');
    expect(items.at(-1)?.brief).toEqual({
      text,
      sql: 'SELECT COUNT(*) FROM accounts',
      rubric: [
        { criterion: 'Goal', marks: 2 },
        { criterion: 'Check', marks: 3 },
      ],
    });
  });

  it("sends the class's dialect notes with the entries this question touches first", async () => {
    const t = setup({ ...fixed, reference_sql: "SELECT id FROM accounts WHERE owner LIKE 'A%'" });
    const r = await t.service.issue({ player: 'p', rewardKey: 'heal:small', dialect: 'postgres' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.challenge.dialect?.name).toBe('PostgreSQL');
    expect(r.challenge.dialect?.entries[0]).toMatchObject({ quirk: 'like-case', here: true });
    expect(r.challenge.dialect?.entries.filter((e) => e.here)).toHaveLength(1);
    const plain = await t.service.issue({
      player: 'q',
      rewardKey: 'heal:small',
      dialect: 'sqlite',
    });
    expect(plain.ok && plain.challenge.dialect).toBeUndefined();
  });

  it('one grading job in flight per player: a flood is turned away, others are not slowed (19.3)', async () => {
    const slowRunner = new InProcessSandboxRunner();
    const delayed = {
      run: async (j: Parameters<typeof slowRunner.run>[0]) => {
        await new Promise((r) => setTimeout(r, 50));
        return slowRunner.run(j);
      },
      close: async () => {},
    };
    const repo = new InMemoryQuestionRepository();
    repo.create(
      questionTemplateSchema.parse({
        ...sampleQuestion,
        ...fixed,
        reference_sql: 'SELECT id FROM accounts',
      }),
      null,
    );
    let clock = 0;
    const service = new ChallengeService({
      matchSeed: 'm',
      selector: new QuestionSelector(repo),
      variants: new VariantBuilder(builtInDatasets),
      grader: new Grader(delayed),
      settings: new StaticSettings(),
      now: () => (clock += 10_000),
    });
    const mine = await service.issue({ player: 'flood', rewardKey: 'heal:small' });
    const theirs = await service.issue({ player: 'calm', rewardKey: 'heal:small' });
    if (!mine.ok || !theirs.ok) throw new Error('issue failed');
    const [run, submit, other] = await Promise.all([
      service.run('flood', mine.challenge.id, 'SELECT 1'),
      service.submit('flood', mine.challenge.id, 'SELECT id FROM accounts'),
      service.submit('calm', theirs.challenge.id, 'SELECT id FROM accounts'),
    ]);
    expect(run.ok).toBe(true);
    expect(submit).toMatchObject({ status: 'rejected', reason: 'rate_limited' });
    expect(other.status).toBe('correct');
  });
});
