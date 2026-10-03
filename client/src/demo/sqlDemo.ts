import { startSandboxScene } from '../render/sandboxScene';
import { h } from '../ui/dom';
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

panel.slots.title.textContent = 'Demo task';
panel.slots.tier.textContent = 'T1';
panel.slots.problem.textContent = 'Problem goes here (Phase 4.2).';
panel.slots.work.textContent = 'Editor goes here (Phase 4.3).';
