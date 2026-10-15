import { HttpAccountApi, accountBase } from './net/account';
import { WebSocketChallengeApi } from './net/WebSocketChallengeApi';
import { h } from './ui/dom';
import { SqlPanel } from './ui/sql/SqlPanel';
import { SqlPanelController } from './ui/sql/SqlPanelController';
import './ui/sql/sqlPanel.css';
import './ui/menu/menu.css';

/**
 * A class's pre- or post-test (Phase 16.10): a short fixed list of questions, no hints, one go at
 * each. What a student shows here is compared before and after the unit.
 */
const params = new URLSearchParams(location.search);
const classId = Number(params.get('assess'));
const kind = params.get('kind') === 'post' ? 'post' : 'pre';
const port = params.get('server') ?? '8080';
const account = new HttpAccountApi(accountBase(location.hostname, params.get('account')));

const address = async () => {
  const ticket = (await account.ticket(classId)) ?? '';
  return `ws://${location.hostname}:${port}/ws/assess?class=${classId}&kind=${kind}&ticket=${encodeURIComponent(ticket)}`;
};

interface Plan {
  total: number;
  done: boolean[];
}

/** Asks how many questions there are and which are done (on a connection of its own). */
function plan(): Promise<Plan> {
  return new Promise((resolve, reject) => {
    void address().then((url) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ t: 'assess_plan' })));
      socket.addEventListener('message', (e) => {
        const m = JSON.parse(String(e.data)) as { t: string } & Plan;
        if (m.t !== 'assess_plan') return;
        resolve(m);
        socket.close();
      });
      socket.addEventListener('close', (e) => {
        if (e.code >= 4000) reject(new Error(e.reason || 'This test is not open'));
      });
    }, reject);
  });
}

const title = kind === 'pre' ? 'Pre-test' : 'Post-test';
const root = h('main', { class: 'menu', attrs: { 'data-role': 'assessment' } });
document.body.appendChild(root);
const panel = new SqlPanel(document.body);
const api = new WebSocketChallengeApi(address);
const controller = new SqlPanelController({ panel, api, onSolved: () => void draw() });
panel.onStateChange((state) => {
  if (state === 'closed') void draw();
});

async function draw(): Promise<void> {
  const card = h('div', { class: 'menu-card' }, h('h1', { text: title }));
  root.replaceChildren(card);
  let p: Plan;
  try {
    p = await plan();
  } catch (err) {
    card.append(
      h('p', {
        class: 'menu-error',
        text: err instanceof Error ? err.message : 'This test is not open.',
      }),
      h('button', { text: 'Back to the menu', on: { click: () => (location.search = '') } }),
    );
    return;
  }
  const left = p.done.filter((d) => !d).length;
  card.append(
    h('p', {
      class: 'menu-note',
      text:
        left === 0
          ? 'All done. Thank you!'
          : `${left} of ${p.total} questions left. No hints, and one go at each: take your time.`,
    }),
    ...p.done.map((done, i) =>
      h('button', {
        text: done ? `Question ${i + 1} ✓` : `Question ${i + 1}`,
        attrs: done ? { disabled: '' } : {},
        on: {
          click: () =>
            void controller.start({
              key: `assess:${i}`,
              label: `${title} · question ${i + 1}`,
              group: title,
            }),
        },
      }),
    ),
    h('button', {
      class: 'menu-quiet',
      text: 'Back to the menu',
      on: { click: () => (location.search = '') },
    }),
  );
}

void draw();
