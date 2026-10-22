import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '@heist/shared';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  bestQuery,
  buildCard,
  drawCard,
  fit,
  queryLines,
  type Pen,
  type ShareCardInput,
} from './shareCard';

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  title: 'T',
  story: '',
  outcome: 'solved',
  rewardKey: 'vault:1',
  tier: 2,
  rcsbe: 'R',
  topics: [],
  secondsOpen: 30,
  hintsUsed: 0,
  yourSql: 'SELECT 1',
  modelSql: 'SELECT secret',
  cards: [],
  ...over,
});

const input = (items: ReviewItem[], over: Partial<ShareCardInput> = {}): ShareCardInput => ({
  name: 'Ana',
  round: 3,
  rank: 2,
  players: 24,
  banked: 12_500,
  kills: 4,
  awards: [{ id: 'quick_draw', playerId: 1, name: 'Ana', value: 18.5 }],
  items,
  ...over,
});

describe('the best query', () => {
  it('is the highest tier solved with a query, the fastest of those', () => {
    const items = [
      item({ title: 'low', tier: 1, secondsOpen: 5 }),
      item({ title: 'slow high', tier: 4, secondsOpen: 90 }),
      item({ title: 'fast high', tier: 4, secondsOpen: 40 }),
      item({ title: 'unsolved', tier: 5, outcome: 'expired' }),
      item({ title: 'no sql', tier: 5, yourSql: null }),
    ];
    expect(bestQuery(items)?.title).toBe('fast high');
    expect(bestQuery([item({ outcome: 'died' })])).toBeUndefined();
  });

  it('cuts a long query to the lines allowed and drops blank lines', () => {
    expect(queryLines('SELECT a\n\n  FROM t   \nWHERE x', 3)).toEqual([
      'SELECT a',
      '  FROM t',
      'WHERE x',
    ]);
    expect(queryLines('a\nb\nc\nd\ne', 3)).toEqual(['a', 'b', '…']);
  });
});

describe('the card', () => {
  it('says place, haul, kills, awards and the best query — never the model answer', () => {
    const card = buildCard(input([item({ yourSql: 'SELECT name\nFROM staff', secondsOpen: 22 })]), {
      showQuery: true,
      maxQueryLines: 8,
    });
    expect(card.stats).toEqual([
      { label: 'Place', value: '#2 of 24' },
      { label: 'Haul', value: '$12,500' },
      { label: 'Kills', value: '4' },
    ]);
    expect(card.awards).toEqual(['Quick Draw · 18.5 s']);
    expect(card.query).toEqual({
      heading: 'Best query',
      detail: 'Tier 2 · solved in 22 s',
      sql: ['SELECT name', 'FROM staff'],
    });
    expect(JSON.stringify(card)).not.toContain('secret');
  });

  it('leaves the query off when the school has switched it off, or there is none', () => {
    expect(
      buildCard(input([item({})]), { showQuery: false, maxQueryLines: 8 }).query,
    ).toBeUndefined();
    expect(buildCard(input([]), { showQuery: true, maxQueryLines: 8 }).query).toBeUndefined();
  });

  it('copes with no rank, and with no awards', () => {
    const noRank = input([], { awards: [] });
    delete (noRank as { rank?: number }).rank;
    const card = buildCard(noRank, {
      showQuery: true,
      maxQueryLines: 8,
    });
    expect(card.stats.map((s) => s.label)).toEqual(['Haul', 'Kills']);
    expect(card.awards).toEqual([]);
  });
});

/** Records what is drawn; every character is 10 px wide. */
function recorder() {
  const texts: { text: string; x: number; y: number; maxWidth?: number }[] = [];
  const rects: number[][] = [];
  const pen: Pen = {
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: (x, y, w, h) => void rects.push([x, y, w, h]),
    fillText: (text, x, y) => void texts.push({ text, x, y }),
    measureText: (t) => ({ width: t.length * 10 }),
  };
  return { pen, texts, rects };
}

describe('drawing', () => {
  it('fits text to a width with an ellipsis', () => {
    const { pen } = recorder();
    expect(fit(pen, 'short', 100)).toBe('short');
    expect(fit(pen, 'a very long line indeed', 100)).toBe('a very lo…');
    expect(pen.measureText(fit(pen, 'x'.repeat(500), 200)).width).toBeLessThanOrEqual(200);
  });

  it('draws the whole card inside its edges, with every line fitted', () => {
    const { pen, texts, rects } = recorder();
    const card = buildCard(
      input([item({ yourSql: 'SELECT ' + 'verylongcolumn, '.repeat(30) })], {
        name: 'A name that is rather long ' + 'x'.repeat(60),
      }),
      { showQuery: true, maxQueryLines: 8 },
    );
    drawCard(pen, card);
    expect(rects[0]).toEqual([0, 0, CARD_WIDTH, CARD_HEIGHT]);
    for (const t of texts) {
      expect(t.y).toBeLessThan(CARD_HEIGHT);
      // Every drawn line fits in the width that is left of where it starts.
      expect(t.x + t.text.length * 10).toBeLessThanOrEqual(CARD_WIDTH);
    }
    const drawn = texts.map((t) => t.text).join('\n');
    expect(drawn).toContain('SQL HEIST CITY');
    expect(drawn).toContain('Round 3');
    expect(drawn).toContain('$12,500');
    expect(drawn).toContain('★ Quick Draw · 18.5 s');
    expect(drawn).toContain('BEST QUERY');
  });
});
