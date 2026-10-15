import { HttpAccountApi, accountBase } from './net/account';
import { WebSocketChallengeApi } from './net/WebSocketChallengeApi';
import { h } from './ui/dom';
import { SqlPanel } from './ui/sql/SqlPanel';
import { StorageDraftStore } from './ui/sql/DraftStore';
import { SqlPanelController } from './ui/sql/SqlPanelController';
import type { TaskOption } from './ui/sql/TaskSwitcher';
import './ui/sql/sqlPanel.css';
import './ui/menu/menu.css';

/**
 * The solo drill (Phase 16.9): pick a topic and a tier, answer questions one after another.
 * No match, no combat, no map: just the SQL pop-up, with the same grading, hints and review of what
 * you wrote as in the game. It counts toward your profile.
 */
interface Topic {
  topic: string;
  title: string;
  questions: number;
  tiers: number[];
}

const params = new URLSearchParams(location.search);
const port = params.get('server') ?? '8080';
const account = new HttpAccountApi(accountBase(location.hostname, params.get('account')));
const base = `ws://${location.hostname}:${port}/ws/practice`;

/** A fresh one-use ticket for every connection (empty when not signed in: development only). */
const address = async () => {
  const ticket = await account.ticket();
  const query = [
    ticket ? `ticket=${encodeURIComponent(ticket)}` : '',
    chosenTopic ? `topic=${encodeURIComponent(chosenTopic)}` : '',
  ].filter(Boolean);
  return query.length ? `${base}?${query.join('&')}` : base;
};

/** Ask the server for something outside the challenge protocol (the topic list, the chosen topic). */
async function control<T>(message: object, expect: string): Promise<T> {
  const url = await address();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => socket.send(JSON.stringify(message)));
    socket.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as { t: string };
      if (m.t === expect) {
        resolve(m as T);
        socket.close();
      }
    });
    socket.addEventListener('error', () => reject(new Error('could not reach the game server')));
  });
}

let chosenTopic: string | undefined;
const api = new WebSocketChallengeApi(address);
const root = h('main', { class: 'menu', attrs: { 'data-role': 'practice' } });
document.body.appendChild(root);
const panel = new SqlPanel(document.body);
let tier = 1;
const controller = new SqlPanelController({
  panel,
  api,
  drafts: new StorageDraftStore(sessionStorage),
  onSolved: () => status.replaceChildren('Correct! Press "Next question" for another.'),
});
const status = h('p', { class: 'menu-note', text: 'Pick a topic and a tier.' });

const next = () => {
  const task: TaskOption = {
    key: `practice:${tier}`,
    label: `Practice · tier ${tier}`,
    group: 'Practice',
  };
  void controller.start(task);
};

async function draw(): Promise<void> {
  let topics: Topic[] = [];
  try {
    topics = (await control<{ topics: Topic[] }>({ t: 'practice_topics' }, 'practice_topics'))
      .topics;
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : 'Could not load topics.';
  }
  const select = h(
    'select',
    { attrs: { 'aria-label': 'Topic' } },
    h('option', { text: 'Any topic', attrs: { value: '' } }),
    ...topics.map((t) =>
      h('option', { text: `${t.title} (${t.questions})`, attrs: { value: t.topic } }),
    ),
  );
  const tiers = h(
    'select',
    { attrs: { 'aria-label': 'Tier' } },
    ...[1, 2, 3, 4, 5].map((t) => h('option', { text: `Tier ${t}`, attrs: { value: String(t) } })),
  );
  const go = h('button', {
    class: 'menu-primary',
    text: 'Next question',
    on: {
      click: async () => {
        tier = Number(tiers.value);
        chosenTopic = select.value || undefined;
        api.close(); // the next connection starts on the chosen topic
        next();
      },
    },
  });
  root.replaceChildren(
    h(
      'div',
      { class: 'menu-card' },
      h('h1', { text: 'Practice SQL' }),
      h('p', { class: 'menu-note', text: 'No match and no combat. Choose what to drill.' }),
      select,
      tiers,
      go,
      status,
      h('button', {
        class: 'menu-quiet',
        text: 'Back to the menu',
        on: { click: () => (location.search = '') },
      }),
    ),
  );
}

void draw();
