import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  addItem,
  emptyTotals,
  lensAxes,
  radarModel,
  type ItemRecord,
  type ProfileMessage,
} from '@heist/shared';
import { drawRadar } from './RadarChart';
import { ProfileView } from './ProfileView';
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
