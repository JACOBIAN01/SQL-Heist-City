import { WebSocketChallengeApi } from '../net/WebSocketChallengeApi';
import { startSandboxScene } from '../render/sandboxScene';
import { h } from '../ui/dom';
import { SqlPanel } from '../ui/sql/SqlPanel';
import { StorageDraftStore } from '../ui/sql/DraftStore';
import { SqlPanelController } from '../ui/sql/SqlPanelController';
import type { TaskOption } from '../ui/sql/TaskSwitcher';
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
// In the real game the host builds this list from the player's situation
// (hurt? holding a weapon? standing at a vault door?).
const tasks: TaskOption[] = [
  { key: 'heal:small', label: 'Small heal', group: 'Heal' },
  { key: 'heal:medium', label: 'Medium heal', group: 'Heal' },
  { key: 'heal:full', label: 'Full heal', group: 'Heal' },
  { key: 'ammo:refill', label: 'Ammo refill', group: 'Ammo' },
  { key: 'gun:pistol', label: 'Pistol', group: 'Gun' },
  { key: 'gun:smg', label: 'SMG', group: 'Gun' },
  { key: 'gun:rifle', label: 'Rifle', group: 'Gun' },
  { key: 'gun:sniper', label: 'Sniper', group: 'Gun' },
  { key: 'vault:bank-3:lock-1', label: 'Bank 3 · lock 1', group: 'Vault', target: 'bank-3' },
  { key: 'vault:bank-3:lock-2', label: 'Bank 3 · lock 2', group: 'Vault', target: 'bank-3' },
];
const panel = new SqlPanel(document.body);
const controller = new SqlPanelController({
  panel,
  api,
  tasks,
  drafts: new StorageDraftStore(sessionStorage),
  onHintCharged: (hint) =>
    (status.textContent = `Hint ${hint.index + 1} revealed → game would charge ${hint.cost} (${hint.costMode})`),
  onSolved: ({ rewardKey }) =>
    (status.textContent = `Server accepted the answer → game would grant: ${rewardKey}`),
});

const start = (label: string, key: string) => {
  const task = tasks.find((t) => t.key === key) as TaskOption;
  return h('button', { text: label, on: { click: () => void controller.start(task) } });
};
hud.append(
  start('Heal', 'heal:small'),
  start('Rifle', 'gun:rifle'),
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
