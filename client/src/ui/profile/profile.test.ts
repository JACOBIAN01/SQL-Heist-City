import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  addItem,
  emptyTotals,
  lensAxes,
  radarModel,
  type ItemRecord,
  type ProfileMessage,
  type ReviewMessage,
} from '@heist/shared';
import { drawRadar } from './RadarChart';
import { ProfileView } from './ProfileView';
import { ReviewView } from './ReviewView';
import { scopeViewOf } from './testing';

afterEach(() => document.body.replaceChildren());

describe('drawRadar', () => {
  it('draws rings, one shape per layer, and every label with its full name', () => {
    const model = radarModel(lensAxes('rcsbe'), [
      { id: 'me', kind: 'fill', values: [40, 60, 80, 20, 30] },
      { id: 'then', kind: 'outline', dashed: true, values: [10, 20, 30, 40, 50] },
    ]);
    const svg = drawRadar(model, { title: 'RCSBE profile' });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('title')?.textContent).toBe('RCSBE profile');
    expect(svg.querySelectorAll('path[data-layer]')).toHaveLength(2);
    const text = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(text.join(' ')).toContain('C · Comprehend');
    expect(text.join(' ')).toContain('E · Evaluate');
    expect(svg.querySelector('path[data-layer="then"]')?.getAttribute('stroke-dasharray')).toBe(
      '5 3',
    );
  });

  it('shows an axis without evidence as a dashed grey spoke labelled "not enough data"', () => {
    const model = radarModel(lensAxes('rcsbe'), [
      { id: 'me', kind: 'fill', values: [null, 50, 50, null, null] },
    ]);
    const svg = drawRadar(model, { title: 't' });
    expect(
      [...svg.querySelectorAll('line[data-thin]')].map((l) => l.getAttribute('data-thin')),
    ).toEqual(['R', 'B', 'E']);
    expect(svg.textContent?.match(/not enough data/g)).toHaveLength(3);
    expect(svg.querySelectorAll('circle')).toHaveLength(2); // only the axes with a score get a dot
  });

  it('pulses the axes that just moved', () => {
    const model = radarModel(lensAxes('rcsbe'), [
      { id: 'me', kind: 'fill', values: [10, 20, 30, 40, 50] },
    ]);
    const svg = drawRadar(model, { title: 't', pulse: ['C'] });
    expect(svg.querySelectorAll('.pulse')).toHaveLength(2); // its dot and its label
  });

  it('never turns text into markup', () => {
    const model = radarModel(
      [
        { key: 'X', label: '<img src=x onerror=alert(1)>' },
        { key: 'Y', label: 'y' },
        { key: 'Z', label: 'z' },
      ],
      [],
    );
    const svg = drawRadar(model, { title: '<b>t</b>' });
    expect(svg.querySelector('img')).toBeNull();
    expect(svg.querySelector('b')).toBeNull();
    expect(svg.textContent).toContain('<img');
  });
});

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: 'c',
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'heal:small',
  tier: 2,
  rcsbe: 'S',
  bloom: 'apply',
  marks: 4,
  topics: [],
  outcome: 'solved',
  runs: 1,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 20,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 1,
  ...over,
});

function message(): ProfileMessage {
  let all = emptyTotals();
  for (let i = 0; i < 4; i++) all = addItem(all, item({ rcsbe: 'S', marks: 3 }), S);
  for (let i = 0; i < 3; i++)
    all = addItem(
      all,
      item({ rcsbe: 'C', bloom: 'understand', outcome: 'expired', submits: 1, marks: 3 }),
      S,
    );
  const round = addItem(emptyTotals(), item(), S);
  return {
    t: 'profile',
    all: scopeViewOf(all),
    round: scopeViewOf(round),
    moved: [{ lens: 'rcsbe', dimension: 'S' }],
  };
}

describe('ProfileView', () => {
  it('asks for a first answer before there is anything to draw', () => {
    const v = new ProfileView('all');
    v.update(undefined as unknown as ProfileMessage);
    expect(v.root.textContent).toContain('Answer a question');
  });

  it('draws both radars, the same numbers in words, and the weakest axis to practise', () => {
    const v = new ProfileView('all');
    v.update(message());
    expect(v.root.querySelectorAll('svg.radar')).toHaveLength(2);
    expect(v.root.textContent).toContain('Solve 100% (4 questions, 12/12 marks)');
    expect(v.root.textContent).toContain('Comprehend 0% (3 questions, 0/9 marks)');
    expect(v.root.textContent).toContain('Recall: no questions yet');
    expect(v.root.querySelector('.profile-focus')?.textContent).toBe('Next: practise Comprehend.');
    expect(v.root.querySelector('li.pulse')?.textContent).toContain('Solve');
  });

  it('in the round card shows this round over everything so far, with a legend', () => {
    const v = new ProfileView('round');
    v.update(message());
    expect(v.root.querySelector('h2')?.textContent).toBe('This round');
    expect(v.root.querySelector('.profile-legend')?.textContent).toBe(
      'Filled: This round. Dashed: All time.',
    );
    expect(v.root.querySelectorAll('path[data-layer]')).toHaveLength(4); // two layers in each of two radars
  });

  it('says so when nothing was answered this round', () => {
    const v = new ProfileView('round');
    const m = message();
    v.update({ t: 'profile', all: m.all });
    expect(v.root.textContent).toContain('No questions answered this round yet');
  });
});

describe('ReviewView (16.2)', () => {
  const message: ReviewMessage = {
    t: 'review',
    round: 2,
    items: [
      {
        title: 'Payroll Leak',
        story: 'List <b>names</b>',
        outcome: 'expired',
        rewardKey: 'heal:small',
        tier: 1,
        rcsbe: 'S',
        topics: ['where'],
        secondsOpen: 42,
        hintsUsed: 1,
        yourSql: 'SELECT name FROM employees',
        modelSql: "SELECT name FROM employees WHERE dept = 'IT'",
        cards: [{ topic: 'where', title: 'WHERE: filter rows', body_md: 'Use conditions.' }],
      },
      {
        title: 'Second',
        story: 's',
        outcome: 'solved',
        rewardKey: 'gun:pistol',
        tier: 1,
        rcsbe: 'S',
        topics: [],
        secondsOpen: 9,
        hintsUsed: 0,
        yourSql: null,
        modelSql: 'SELECT 2',
        cards: [],
      },
    ],
  };

  it('shows each question with your query, the model answer and its concept card', () => {
    const v = new ReviewView();
    v.update(message);
    expect(v.root.querySelector('h2')?.textContent).toBe('Round 2 review');
    const items = v.root.querySelectorAll('.review-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.className).toContain('missed');
    expect(items[1]?.className).toContain('solved');
    const first = items[0] as HTMLElement;
    expect(first.textContent).toContain('Ran out of time · 42 s · 1 paid hint · where');
    expect(first.querySelectorAll('pre')[0]?.textContent).toBe('SELECT name FROM employees');
    expect(first.querySelectorAll('pre')[1]?.textContent).toContain("dept = 'IT'");
    expect(first.querySelector('summary')?.textContent).toBe('Concept: WHERE: filter rows');
    expect(items[1]?.querySelector('pre')?.textContent).toBe('(you did not run a query)');
    expect(v.hasReview).toBe(true);
  });

  it('draws text as text', () => {
    const v = new ReviewView();
    v.update(message);
    expect(v.root.querySelector('.review-story b')).toBeNull();
    expect(v.root.querySelector('.review-story')?.textContent).toBe('List <b>names</b>');
  });

  it('says there is nothing yet before a round has ended', () => {
    const v = new ReviewView();
    v.update({ t: 'review', round: 1, items: [] });
    expect(v.root.textContent).toContain('No questions to review yet');
    expect(v.hasReview).toBe(false);
  });
});
