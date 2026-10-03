import { WebSocketChallengeApi } from '../net/WebSocketChallengeApi';
import { startSandboxScene } from '../render/sandboxScene';
import { h } from '../ui/dom';
import { SqlPanel } from '../ui/sql/SqlPanel';
import { SqlPanelController } from '../ui/sql/SqlPanelController';
import '../ui/sql/sqlPanel.css';

/**
 * Demo composition root: a spinning cube stands in for the world so you can
 * see the panel never pauses rendering. The panel talks to the real game
 * server over WebSocket (start it with `npm run dev:server`). Replaced by
 * the real game from Phase 5.
 */
startSandboxScene(document.body);

const hud = document.getElementById('demo-hud') as HTMLElement;
const status = h('div', { text: 'The world keeps running behind the panel.' });
const serverPort = new URLSearchParams(location.search).get('server') ?? '8080';
const api = new WebSocketChallengeApi(`ws://${location.hostname}:${serverPort}/ws/challenge`);
const panel = new SqlPanel(document.body);
const controller = new SqlPanelController({
  panel,
  api,
  onHintCharged: (hint) =>
    (status.textContent = `Hint ${hint.index + 1} revealed → game would charge ${hint.cost} (${hint.costMode})`),
  onSolved: ({ rewardKey }) =>
    (status.textContent = `Server accepted the answer → game would grant: ${rewardKey}`),
});

const start = (label: string, rewardKey: string) =>
  h('button', { text: label, on: { click: () => void controller.start(rewardKey) } });
hud.append(
  start('Heal +20 (tier 1)', 'heal:small'),
  start('Rifle (tier 4)', 'gun:rifle'),
  start('Vault: bank 3, lock 1', 'vault:bank-3:lock-1'),
  status,
);

panel.onStateChange((state) => {
  status.textContent =
    state === 'open'
      ? 'Panel open — the player would auto-crouch but is still vulnerable.'
      : state === 'minimised'
        ? 'Minimised — keep fighting; the timer still runs.'
        : 'Panel closed.';
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  if (panel.state === 'minimised') {
    event.preventDefault();
    panel.restore();
  }
});
