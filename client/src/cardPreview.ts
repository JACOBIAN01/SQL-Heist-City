import { buildCard, drawCard, type Pen } from './ui/share/shareCard';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const card = buildCard(
  {
    name: 'Ana Silva',
    round: 3,
    rank: 2,
    players: 24,
    banked: 125_000,
    kills: 4,
    awards: [
      { id: 'quick_draw', playerId: 1, name: 'Ana', value: 18.5 },
      { id: 'sql_brain', playerId: 1, name: 'Ana', value: 9 },
    ],
    items: [
      {
        title: 'Vault lock',
        story: '',
        outcome: 'solved',
        rewardKey: 'vault:1',
        tier: 4,
        rcsbe: 'R',
        topics: [],
        secondsOpen: 74,
        hintsUsed: 0,
        yourSql:
          'SELECT d.name, COUNT(*) AS staff\nFROM departments d\nJOIN employees e ON e.dept_id = d.id\nGROUP BY d.name\nHAVING COUNT(*) > 3\nORDER BY staff DESC;',
        modelSql: '',
        cards: [],
      },
    ],
  },
  { showQuery: true, maxQueryLines: 8 },
);
drawCard(canvas.getContext('2d') as unknown as Pen, card);
document.title = 'ready';
