import { I18n } from './i18n/I18n';
import { ActsView } from './ui/hud/ActsView';
import { BoardView } from './ui/hud/BoardView';
import { JobView } from './ui/hud/JobView';
import { PayoutView } from './ui/hud/PayoutView';

// Development only: the mission screens with sample data, for reviews and screenshots.
const i18n = new I18n('en');
const row = document.getElementById('row') as HTMLElement;

const acts = new ActsView(i18n);
acts.update({ t: 'acts', bank: 'bank-3', act: 'getaway', intel: 3, intelMax: 3, take: 61_500 }, 0);
const job = new JobView(i18n);
job.update(
  {
    t: 'job',
    kind: 'sabotage',
    status: 'active',
    targets: [{ x: 0, z: 0 }],
    index: 0,
    secondsLeft: 118,
    reward: 4_000,
    dwell: 0.6,
  },
  performance.now(),
);
const board = new BoardView(i18n, () => {});
board.open('docks:board', ['delivery', 'escort', 'sabotage']);
const payout = new PayoutView(i18n);
payout.show({
  t: 'payout',
  outcome: 'complete',
  bank: 'bank-3',
  total: 64_000,
  lines: [
    { id: 'vault', amount: 50_000 },
    { id: 'ghost', amount: 7_500 },
    { id: 'intel', amount: 5_000 },
    { id: 'locks', amount: 1_500 },
  ],
  mastery: 145,
});
row.append(acts.root, job.root, board.panel, payout.panel);
