import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const button = (label: RegExp) =>
  [...host.querySelectorAll('button')].find((b) =>
    label.test(b.textContent ?? ''),
  ) as HTMLButtonElement;
const start = () => controller.start({ key: 'heal:small', label: 'Heal', group: 'heal' });

describe('task kinds in the pop-up (17.1)', () => {
  it('fix: the broken query is shown and put in the editor', async () => {
    api.onRequest = async () => ({
      ok: true,
      challenge: sampleChallenge({ task: { kind: 'fix', brokenSql: 'SELEC name FROM employees' } }),
    });
    await start();
    expect(host.textContent).toContain('The broken query');
    expect(controller['work'].editor.getValue()).toBe('SELEC name FROM employees');
  });

  it('choice: shows the result, hides the editor, and sends the picks', async () => {
    api.onRequest = async () => ({
      ok: true,
      challenge: sampleChallenge({
        task: {
          kind: 'choice',
          shownSql: 'SELECT COUNT(*) FROM employees',
          shown: { kind: 'result', columns: ['COUNT(*)'], rows: [[3]] },
          parts: [
            {
              prompt: 'Why 3?',
              options: [
                { id: 'a', text: 'one per row' },
                { id: 'b', text: 'one per name' },
              ],
              multi: false,
            },
          ],
        },
      }),
    });
    api.onSubmit = async () => ({
      status: 'answered',
      share: 0,
      feedback: { code: 'partial', message: 'Not the right answer.' },
    });
    await start();
    expect((host.querySelector('.sqlp-editor') as HTMLElement).hidden).toBe(true);
    expect(button(/Run/).hidden).toBe(true);
    (host.querySelector('input[value="b"]') as HTMLInputElement).click();
    button(/Submit/).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls.at(-1)).toEqual({ method: 'submit', args: ['c1', '', { choices: [['b']] }] });
    expect(host.textContent).toContain('0% of the marks');
  });

  it('fill: one input per blank', async () => {
    api.onRequest = async () => ({
      ok: true,
      challenge: sampleChallenge({
        task: { kind: 'fill', textSql: 'SELECT ___(*) FROM t ___ x', blanks: 2 },
      }),
    });
    api.onSubmit = async () => ({ status: 'correct', rewardKey: 'heal:small', target: null });
    await start();
    const inputs = [...host.querySelectorAll<HTMLInputElement>('.sqlp-blank')];
    expect(inputs).toHaveLength(2);
    inputs.forEach((i, n) => (i.value = n === 0 ? 'COUNT' : 'GROUP BY'));
    button(/Submit/).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls.at(-1)?.args[2]).toEqual({ blanks: ['COUNT', 'GROUP BY'] });
  });

  it('brief: the write-up and the queries go together; handed in', async () => {
    api.onRequest = async () => ({
      ok: true,
      challenge: sampleChallenge({
        task: { kind: 'brief', rubric: [{ criterion: 'States a goal', marks: 2 }] },
      }),
    });
    api.onSubmit = async () => ({ status: 'received' });
    await start();
    expect(host.textContent).toContain('States a goal (2 marks)');
    (host.querySelector('.sqlp-brief') as HTMLTextAreaElement).value = 'Goal: big balances.';
    controller['work'].editor.setValue('SELECT 1');
    button(/Submit/).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls.at(-1)?.args).toEqual(['c1', 'SELECT 1', { text: 'Goal: big balances.' }]);
    expect(host.textContent).toContain('Handed in');
  });
});
