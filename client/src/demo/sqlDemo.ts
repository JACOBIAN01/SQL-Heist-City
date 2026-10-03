import type { PublicChallenge } from '@heist/shared';
import { startSandboxScene } from '../render/sandboxScene';
import { h } from '../ui/dom';
import { ProblemPane } from '../ui/sql/ProblemPane';
import { SqlPanel } from '../ui/sql/SqlPanel';
import '../ui/sql/sqlPanel.css';

/**
 * Demo composition root: a spinning cube stands in for the world so you can
 * see that the panel never pauses rendering. Replaced by the real game
 * in Phase 5+.
 */
startSandboxScene(document.body);

const hud = document.getElementById('demo-hud') as HTMLElement;
const panel = new SqlPanel(document.body);
const status = h('div', { text: 'Panel closed — the world keeps running behind it.' });
hud.append(
  h('button', { text: 'Open SQL panel (Tab)', on: { click: () => panel.open() } }),
  status,
);

panel.onStateChange((state) => {
  status.textContent =
    state === 'open'
      ? 'Panel open — player would auto-crouch, but is still vulnerable.'
      : state === 'minimised'
        ? 'Minimised — keep fighting; the timer still runs.'
        : 'Panel closed.';
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && panel.state !== 'open') {
    event.preventDefault();
    if (panel.state === 'minimised') panel.restore();
    else panel.open();
  }
});

// Sample payload until the panel is wired to the server (subphase 4.4).
const sample: PublicChallenge = {
  id: 'demo',
  rewardKey: 'heal:small',
  tier: 1,
  title: 'Payroll Leak',
  story:
    'Return the **first_name** and **salary** of employees earning more than **5000**.\nUse `WHERE`.',
  schemaSql:
    'CREATE TABLE employees (id INTEGER PRIMARY KEY, first_name TEXT, dept TEXT, salary INTEGER);',
  tables: [
    {
      name: 'employees',
      columns: ['id', 'first_name', 'dept', 'salary'],
      sampleRows: [
        [1, 'Ana', 'Audit', 6200],
        [2, 'Ben', 'IT', 4100],
        [3, 'Chen', 'Teller', null],
      ],
      rowCount: 48,
    },
  ],
  hintCount: 2,
  expiresAt: Date.now() + 5 * 60_000,
};

panel.slots.title.textContent = sample.title;
panel.slots.tier.textContent = `T${sample.tier}`;
new ProblemPane(panel.slots.problem).show(sample);
panel.slots.work.textContent = 'Editor goes here (Phase 4.3).';
