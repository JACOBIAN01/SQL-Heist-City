import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChallengeConnectionError } from '../../net/ChallengeApi';
import { FakeChallengeApi, sampleChallenge } from '../../testing/FakeChallengeApi';
import { SqlPanel } from './SqlPanel';
import { SqlPanelController } from './SqlPanelController';

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

async function started(sql = 'SELECT name FROM employees') {
  await controller.start('heist:test');
  controller['work'].editor.setValue(sql);
}

describe('SqlPanelController: starting a task', () => {
  it("opens the panel on the server's challenge: header, story and tables", async () => {
    await controller.start('heal:small', 'self');
    expect(api.calls[0]).toEqual({ method: 'request', args: ['heal:small', 'self'] });
    expect(panel.state).toBe('open');
    expect(panel.slots.title.textContent).toBe('Payroll Leak');
    expect(panel.slots.tier.textContent).toBe('T1');
    expect($('.sqlp-story strong').textContent).toBe('everyone');
    expect($('.sqlp-card code').textContent).toBe('employees');
  });

  it("shows the server's refusal in plain words and keeps Run disabled", async () => {
    api.onRequest = async () => ({ ok: false, reason: 'no_questions' });
    await controller.start('heal:small');
    expect($('.sqlp-problem').textContent).toMatch(/No questions are available/);
    expect(button(/Run/).disabled).toBe(true);
  });

  it('explains a connection failure', async () => {
    api.onRequest = async () => {
      throw new ChallengeConnectionError('down');
    };
    await controller.start('heal:small');
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

it('uses a sample challenge for the header bar text', async () => {
  api.onRequest = async () => ({
    ok: true,
    challenge: sampleChallenge({ title: 'Heist 1', tier: 3 }),
  });
  await controller.start('vault:bank-1:lock-1');
  expect(panel.slots.tier.textContent).toBe('T3');
});
