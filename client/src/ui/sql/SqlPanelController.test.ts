import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChallengeConnectionError } from '../../net/ChallengeApi';
import { FakeChallengeApi, sampleChallenge } from '../../testing/FakeChallengeApi';
import { SqlPanel } from './SqlPanel';
import type { HintReveal } from '@heist/shared';
import { SqlPanelController, type SolvedInfo } from './SqlPanelController';
import type { TaskOption } from './TaskSwitcher';

let host: HTMLElement;
let panel: SqlPanel;
let api: FakeChallengeApi;
let controller: SqlPanelController;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  panel = new SqlPanel(host);
  api = new FakeChallengeApi();
  controller = new SqlPanelController({ panel, api });
});
afterEach(() => {
  controller.destroy();
  panel.destroy();
  host.remove();
});

const $ = (selector: string) => host.querySelector(selector) as HTMLElement;
const button = (label: RegExp) =>
  [...host.querySelectorAll('button')].find((b) =>
    label.test(b.textContent ?? ''),
  ) as HTMLButtonElement;
const flush = () => new Promise((r) => setTimeout(r, 0));
const task = (key: string, target?: string): TaskOption => ({
  key,
  label: key,
  group: key.split(':')[0] ?? key,
  ...(target === undefined ? {} : { target }),
});

async function started(sql = 'SELECT name FROM employees') {
  await controller.start(task('heist:test'));
  controller['work'].editor.setValue(sql);
}

describe('SqlPanelController: starting a task', () => {
  it("opens the panel on the server's challenge: header, story and tables", async () => {
    await controller.start(task('heal:small', 'self'));
    expect(api.calls[0]).toEqual({ method: 'request', args: ['heal:small', 'self'] });
    expect(panel.state).toBe('open');
    expect(panel.slots.title.textContent).toBe('Payroll Leak');
    expect(panel.slots.tier.textContent).toBe('T1');
    expect($('.sqlp-story strong').textContent).toBe('everyone');
    expect($('.sqlp-card code').textContent).toBe('employees');
  });

  it("shows the server's refusal in plain words and keeps Run disabled", async () => {
    api.onRequest = async () => ({ ok: false, reason: 'no_questions' });
    await controller.start(task('heal:small'));
    expect($('.sqlp-problem').textContent).toMatch(/No questions are available/);
    expect(button(/Run/).disabled).toBe(true);
  });

  it('explains a connection failure', async () => {
    api.onRequest = async () => {
      throw new ChallengeConnectionError('down');
    };
    await controller.start(task('heal:small'));
    expect($('.sqlp-problem').textContent).toMatch(/Cannot reach the game server/);
  });
});

describe('SqlPanelController: Run (free preview)', () => {
  it('sends the typed query and shows the preview rows', async () => {
    await started('SELECT name FROM employees');
    await controller.run();
    expect(api.calls.at(-1)).toEqual({ method: 'run', args: ['c1', 'SELECT name FROM employees'] });
    const result = $('.sqlp-result');
    expect(result.textContent).toContain('Preview');
    expect(result.textContent).toContain('Ana');
    expect(result.textContent).toContain('Preview only');
  });

  it('notes truncated previews and empty results', async () => {
    await started();
    api.onRun = async () => ({
      ok: true,
      preview: { columns: ['n'], rows: [[1], [2]], truncated: true },
    });
    await controller.run();
    expect($('.sqlp-result').textContent).toContain('first 2 rows');
    api.onRun = async () => ({ ok: true, preview: { columns: ['n'], rows: [], truncated: false } });
    await controller.run();
    expect($('.sqlp-result').textContent).toContain('returned no rows');
  });

  it('shows SQL errors from the server as errors', async () => {
    await started('SELECT nope');
    api.onRun = async () => ({
      ok: false,
      reason: 'sql',
      feedback: { code: 'sql_error', message: 'no such column: nope' },
    });
    await controller.run();
    expect($('.sqlp-msg.error').textContent).toBe('no such column: nope');
  });

  it('says how long to wait when rate-limited', async () => {
    await started();
    api.onRun = async () => ({ ok: false, reason: 'rate_limited', retryAt: api.clock + 1_200 });
    await controller.run();
    expect($('.sqlp-msg.error').textContent).toBe('Slow down — try again in 2 s.');
  });

  it('refuses an empty query without calling the server', async () => {
    await started('   ');
    await controller.run();
    expect(api.calls.filter((c) => c.method === 'run')).toHaveLength(0);
    expect($('.sqlp-result').textContent).toBe('Write a query first.');
  });

  it('disables Run while waiting and ignores a second press', async () => {
    await started();
    let release!: () => void;
    api.onRun = () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, preview: { columns: [], rows: [], truncated: false } });
      });
    const first = controller.run();
    expect(button(/Run/).disabled).toBe(true);
    await controller.run();
    expect(api.calls.filter((c) => c.method === 'run')).toHaveLength(1);
    release();
    await first;
    await flush();
    expect(button(/Run/).disabled).toBe(false);
  });

  it('shows a connection error when the run fails to reach the server', async () => {
    await started();
    api.onRun = async () => {
      throw new ChallengeConnectionError('down');
    };
    await controller.run();
    expect($('.sqlp-msg.error').textContent).toMatch(/Cannot reach the game server/);
  });

  it('does nothing before a task exists', async () => {
    await controller.run();
    expect(api.calls).toHaveLength(0);
  });
});

describe('SqlPanelController: Submit (graded)', () => {
  it('sends the query, shows success, announces the reward once and ends the task', async () => {
    const solved: SolvedInfo[] = [];
    controller.destroy();
    panel.destroy();
    host.replaceChildren();
    panel = new SqlPanel(host);
    controller = new SqlPanelController({ panel, api, onSolved: (i) => solved.push(i) });
    await started('SELECT name FROM employees');
    api.onSubmit = async () => ({ status: 'correct', rewardKey: 'gun:rifle', target: 'slot-1' });
    await controller.submit();
    expect(api.calls.at(-1)).toEqual({
      method: 'submit',
      args: ['c1', 'SELECT name FROM employees'],
    });
    expect($('.sqlp-msg.ok').textContent).toBe('✔ Correct! Rifle unlocked.');
    expect(solved).toEqual([{ rewardKey: 'gun:rifle', target: 'slot-1' }]);
    // The task is finished: no more runs or submits, editor locked.
    await controller.submit();
    await controller.run();
    expect(api.calls.filter((c) => c.method === 'submit')).toHaveLength(1);
    expect($('.cm-content').getAttribute('aria-readonly')).toBe('true');
    button(/Continue/).click();
    expect(panel.state).toBe('closed');
  });

  it('a new task unlocks the editor again', async () => {
    await started();
    await controller.submit();
    await controller.start(task('heal:small'));
    expect($('.cm-content').getAttribute('aria-readonly')).toBeNull();
  });

  it("shows the server's feedback for a wrong answer without revealing anything else", async () => {
    await started('SELECT 1');
    api.onSubmit = async () => ({
      status: 'wrong',
      feedback: { code: 'row_count', message: 'Your query returns 5 rows; the answer has 3.' },
      lockedUntil: api.clock + 10_000,
    });
    await controller.submit();
    expect($('.sqlp-msg.wrong').textContent).toBe(
      '✘ Not quite. Your query returns 5 rows; the answer has 3.',
    );
    expect(panel.state).toBe('open');
  });

  it('reports a lockout and other refusals', async () => {
    await started();
    api.onSubmit = async () => ({ status: 'locked', lockedUntil: api.clock + 4_200 });
    await controller.submit();
    expect($('.sqlp-msg.wrong').textContent).toBe('Locked out — try again in 5 s.');
    // A fresh task has no lockout; the server may still refuse (here: expired).
    await started('SELECT 1');
    api.onSubmit = async () => ({ status: 'rejected', reason: 'expired' });
    await controller.submit();
    expect($('.sqlp-msg.error').textContent).toMatch(/expired/);
  });

  it('refuses an empty query and survives a dropped connection', async () => {
    await started('  ');
    await controller.submit();
    expect(api.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
    controller['work'].editor.setValue('SELECT 1');
    api.onSubmit = async () => {
      throw new ChallengeConnectionError('down');
    };
    await controller.submit();
    expect($('.sqlp-msg.error').textContent).toMatch(/Cannot reach the game server/);
    expect(button(/Submit/).disabled).toBe(false);
  });
});

describe('SqlPanelController: switching tasks and drafts', () => {
  const rebuild = (tasks: TaskOption[]) => {
    controller.destroy();
    panel.destroy();
    host.replaceChildren();
    panel = new SqlPanel(host);
    controller = new SqlPanelController({ panel, api, tasks });
  };
  const tasks = [task('heal:small'), task('gun:rifle'), task('vault:bank-1:lock-1', 'bank-1')];
  const typed = () => controller['work'].editor.getValue();
  const type = (text: string) =>
    controller['work'].editor['view'].dispatch({
      changes: { from: 0, to: controller['work'].editor['view'].state.doc.length, insert: text },
      userEvent: 'input.type',
    });

  it('lists the tasks in the header and starts the chosen one with a fresh request', async () => {
    rebuild(tasks);
    await controller.start(tasks[0] as TaskOption);
    const select = $('select.sqlp-select') as HTMLSelectElement;
    expect(select.value).toBe('heal:small');
    select.value = 'vault:bank-1:lock-1';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(api.calls.filter((c) => c.method === 'request').map((c) => c.args)).toEqual([
      ['heal:small', undefined],
      ['vault:bank-1:lock-1', 'bank-1'],
    ]);
  });

  it("keeps each task's draft when switching away and back", async () => {
    rebuild(tasks);
    await controller.start(tasks[0] as TaskOption);
    type('SELECT heal');
    await controller.start(tasks[1] as TaskOption);
    expect(typed()).toBe('');
    type('SELECT rifle');
    await controller.start(tasks[0] as TaskOption);
    expect(typed()).toBe('SELECT heal');
    await controller.start(tasks[1] as TaskOption);
    expect(typed()).toBe('SELECT rifle');
  });

  it('drops the draft once that task is solved', async () => {
    rebuild(tasks);
    await controller.start(tasks[0] as TaskOption);
    type('SELECT 1');
    await controller.submit();
    await controller.start(tasks[0] as TaskOption);
    expect(typed()).toBe('');
  });

  it('gets a new question every time, even for the same task', async () => {
    rebuild(tasks);
    let n = 0;
    api.onRequest = async () => ({ ok: true, challenge: sampleChallenge({ id: `c${++n}` }) });
    await controller.start(tasks[0] as TaskOption);
    await controller.start(tasks[0] as TaskOption);
    expect(api.calls.filter((c) => c.method === 'request')).toHaveLength(2);
    controller['work'].editor.setValue('SELECT 1');
    await controller.run();
    expect(api.calls.at(-1)).toEqual({ method: 'run', args: ['c2', 'SELECT 1'] });
  });
});

describe('SqlPanelController: task timer and expiry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => {
    api.clock += ms;
    vi.advanceTimersByTime(ms);
  };
  // sampleChallenge expires at 1_300_000 and the fake clock starts at 1_000_000 → 5:00.
  const timer = () => $('.sqlp-timer');

  it('counts down in the header and on the minimised bar, turning red near the end', async () => {
    await controller.start(task('heal:small'));
    expect(timer().textContent).toBe('5:00');
    advance(61_000);
    expect(timer().textContent).toBe('3:59');
    expect(timer().dataset.urgent).toBe('false');
    panel.minimise();
    advance(200_000);
    expect($('.sqlp-bar').textContent).toContain('0:39');
    advance(10_000);
    expect(timer().dataset.urgent).toBe('true');
  });

  it('expires cleanly: no penalty message, controls off, server told, one-click new question', async () => {
    await controller.start(task('heal:small'));
    advance(300_000);
    expect(timer().textContent).toBe('Expired');
    expect($('.sqlp-msg.error').textContent).toMatch(/expired\. There is no penalty/);
    expect(api.calls.at(-1)?.method).toBe('abandon');
    expect(button(/Run/).disabled).toBe(true);
    expect(button(/Hint/).hidden).toBe(true);
    expect($('.cm-content').getAttribute('aria-readonly')).toBe('true');
    await controller.run();
    await controller.submit();
    expect(api.calls.filter((c) => c.method === 'run' || c.method === 'submit')).toHaveLength(0);

    // The server issues the next question with a fresh deadline.
    api.onRequest = async () => ({
      ok: true,
      challenge: sampleChallenge({ expiresAt: api.clock + 300_000 }),
    });
    button(/Get a new question/).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.calls.filter((c) => c.method === 'request')).toHaveLength(2);
    expect(timer().textContent).toBe('5:00');
  });

  it('stays minimised when it expires (the player may be fighting) and says so on the bar', async () => {
    await controller.start(task('heal:small'));
    panel.minimise();
    advance(300_000);
    expect(panel.state).toBe('minimised');
    expect($('.sqlp-bar').textContent).toContain('Expired');
  });

  it('follows the server when it reports the task expired', async () => {
    await controller.start(task('heal:small'));
    controller['work'].editor.setValue('SELECT 1');
    api.onSubmit = async () => ({ status: 'rejected', reason: 'expired' });
    await controller.submit();
    expect(timer().textContent).toBe('Expired');
    expect($('.sqlp-msg.error').textContent).toMatch(/expired/);
  });

  it('closing the panel abandons the task and stops the timer; minimising does not', async () => {
    await controller.start(task('heal:small'));
    panel.minimise();
    expect(api.calls.some((c) => c.method === 'abandon')).toBe(false);
    panel.restore();
    panel.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.calls.at(-1)?.method).toBe('abandon');
    expect(controller['ticker']).toBeUndefined();
  });

  it('does not abandon after a solved task is closed', async () => {
    await controller.start(task('heal:small'));
    controller['work'].editor.setValue('SELECT 1');
    await controller.submit();
    panel.close();
    expect(api.calls.some((c) => c.method === 'abandon')).toBe(false);
  });
});

describe('SqlPanelController: hints', () => {
  it('shows what the next hint costs before it is taken', async () => {
    await controller.start(task('heal:small'));
    expect(button(/Hint/).textContent).toBe('Hint 1/2 · −5% of your cash');
  });

  it('reveals hints in order, shows them in the task, announces the charge once', async () => {
    const charged: HintReveal[] = [];
    controller.destroy();
    panel.destroy();
    host.replaceChildren();
    panel = new SqlPanel(host);
    controller = new SqlPanelController({ panel, api, onHintCharged: (h) => charged.push(h) });
    await controller.start(task('heal:small'));

    button(/Hint 1/).click();
    await flush();
    expect(api.calls.at(-1)).toEqual({ method: 'hint', args: ['c1', 0] });
    expect($('.sqlp-hints').textContent).toContain('Hint number 1');
    expect(button(/Hint/).textContent).toBe('Hint 2/2 · −10% of your cash');

    button(/Hint 2/).click();
    await flush();
    expect(api.calls.at(-1)).toEqual({ method: 'hint', args: ['c1', 1] });
    expect([...host.querySelectorAll('.sqlp-hint')]).toHaveLength(2);
    expect(host.querySelector('.sqlp-toolbar button:last-child')?.hasAttribute('hidden')).toBe(
      true,
    );
    expect(charged.map((h) => h.index)).toEqual([0, 1]);
  });

  it('does not announce a charge for a repeated (free) hint', async () => {
    const charged: HintReveal[] = [];
    controller.destroy();
    panel.destroy();
    host.replaceChildren();
    panel = new SqlPanel(host);
    controller = new SqlPanelController({ panel, api, onHintCharged: (h) => charged.push(h) });
    await controller.start(task('heal:small'));
    api.onHint = async (_id, index) => ({
      ok: true,
      hint: { index, text: 'again', cost: 0.05, costMode: 'fraction', charged: false },
    });
    await controller.hint();
    expect(charged).toEqual([]);
    expect($('.sqlp-hints').textContent).toContain('again');
  });

  it('hides the button for tasks without hints and after the task is solved', async () => {
    api.onRequest = async () => ({ ok: true, challenge: sampleChallenge({ hintCosts: [] }) });
    await controller.start(task('heal:small'));
    expect(button(/Hint/).hidden).toBe(true);
    api.onRequest = async () => ({ ok: true, challenge: sampleChallenge() });
    await controller.start(task('heal:small'));
    expect(button(/Hint/).hidden).toBe(false);
    controller['work'].editor.setValue('SELECT 1');
    await controller.submit();
    expect(button(/Hint/).hidden).toBe(true);
  });

  it('shows a refusal message and connection errors', async () => {
    await controller.start(task('heal:small'));
    api.onHint = async () => ({ ok: false, reason: 'rate_limited' });
    await controller.hint();
    expect($('.sqlp-msg.error').textContent).toMatch(/Slow down/);
    api.onHint = async () => {
      throw new ChallengeConnectionError('down');
    };
    await controller.hint();
    expect($('.sqlp-msg.error').textContent).toMatch(/Cannot reach the game server/);
  });
});

describe('SqlPanelController: lockout countdown', () => {
  const wrong = (until: number) => async () => ({
    status: 'wrong' as const,
    feedback: { code: 'row_count', message: 'Off.' },
    lockedUntil: until,
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => {
    api.clock += ms;
    vi.advanceTimersByTime(ms);
  };

  it("locks Submit for the server's time, counts down, then unlocks", async () => {
    await started('SELECT 1');
    api.onSubmit = wrong(api.clock + 10_000);
    await controller.submit();
    expect(button(/Locked/).textContent).toBe('Locked 10 s');
    expect(button(/Locked/).disabled).toBe(true);

    advance(3_000);
    expect(button(/Locked/).textContent).toBe('Locked 7 s');
    advance(7_000);
    expect(button(/Submit/).textContent).toBe('Submit ✔');
    expect(button(/Submit/).disabled).toBe(false);
  });

  it('does not bother the server while locked locally', async () => {
    await started('SELECT 1');
    api.onSubmit = wrong(api.clock + 10_000);
    await controller.submit();
    await controller.submit();
    expect(api.calls.filter((c) => c.method === 'submit')).toHaveLength(1);
    expect($('.sqlp-msg.wrong').textContent).toBe('Locked out — try again in 10 s.');
  });

  it('Run still works during a lockout (you can fix your query)', async () => {
    await started('SELECT 1');
    api.onSubmit = wrong(api.clock + 10_000);
    await controller.submit();
    await controller.run();
    expect(api.calls.filter((c) => c.method === 'run')).toHaveLength(1);
    expect(button(/Locked/).disabled).toBe(true);
    expect(button(/Run/).disabled).toBe(false);
  });

  it('follows a server-reported lockout (e.g. after reconnecting)', async () => {
    await started('SELECT 1');
    api.onSubmit = async () => ({ status: 'locked', lockedUntil: api.clock + 4_000 });
    await controller.submit();
    expect(button(/Locked/).textContent).toBe('Locked 4 s');
  });

  it('a new task clears the lockout', async () => {
    await started('SELECT 1');
    api.onSubmit = wrong(api.clock + 10_000);
    await controller.submit();
    await controller.start(task('heal:small'));
    expect(button(/Submit/).disabled).toBe(false);
    expect(button(/Submit/).textContent).toBe('Submit ✔');
  });
});

it('uses a sample challenge for the header bar text', async () => {
  api.onRequest = async () => ({
    ok: true,
    challenge: sampleChallenge({ title: 'Heist 1', tier: 3 }),
  });
  await controller.start(task('vault:bank-1:lock-1'));
  expect(panel.slots.tier.textContent).toBe('T3');
});
