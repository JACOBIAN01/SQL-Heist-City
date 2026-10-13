import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type ItemRecord,
} from '@heist/shared';
import { StaticConcepts } from '../concepts/ConceptStore';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ReviewKeeper } from './ReviewKeeper';

const card = {
  topic: 'where',
  title: 'WHERE: filter rows',
  nudge: 'n',
  body_md: 'Use conditions.',
};

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: `c${Math.random()}`,
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'heal:small',
  tier: 1,
  rcsbe: 'S',
  bloom: 'apply',
  marks: 1,
  topics: ['where', 'unknown-topic'],
  outcome: 'expired',
  runs: 1,
  submits: 1,
  wrongSubmits: 1,
  hintsPaid: 1,
  secondsOpen: 41.6,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 1,
  review: {
    title: 'Payroll Leak',
    story: 'List the names…',
    lastSql: 'SELECT name FROM employees',
    modelSql: "SELECT name FROM employees WHERE dept = 'IT'",
  },
  ...over,
});

function setup() {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
  });
  const keeper = new ReviewKeeper(new StaticConcepts([card]));
  keeper.bind(match);
  const join = (name: string) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  };
  return { match, keeper, join };
}

describe('post-round review (16.2)', () => {
  it('sends each player the questions they met, their last query, the model answer and the concept cards, once the round ends', () => {
    const { match, keeper, join } = setup();
    const ana = join('Ana');
    const ben = join('Ben');
    keeper.item(item(), { playerKey: ana.player.key });
    keeper.item(
      item({
        outcome: 'solved',
        hintsPaid: 0,
        review: { title: 'Second', story: 's', modelSql: 'SELECT 2' },
      }),
      { playerKey: ana.player.key },
    );
    expect(ana.connection.jsonOf('review')).toEqual([]); // nothing during the round
    match.heist.endRound();
    const reviews = ana.connection.jsonOf('review');
    expect(reviews).toHaveLength(1);
    const [first, second] = reviews[0]?.items ?? [];
    expect(reviews[0]?.round).toBe(1);
    expect(first).toMatchObject({
      title: 'Payroll Leak',
      outcome: 'expired',
      yourSql: 'SELECT name FROM employees',
      modelSql: "SELECT name FROM employees WHERE dept = 'IT'",
      secondsOpen: 42,
      hintsUsed: 1,
      topics: ['where', 'unknown-topic'],
    });
    expect(first?.cards).toEqual([
      { topic: 'where', title: 'WHERE: filter rows', body_md: 'Use conditions.' },
    ]);
    expect(second).toMatchObject({ yourSql: null, outcome: 'solved' });
    // A player who met no question gets no review, and nobody sees another's.
    expect(ben.connection.jsonOf('review')).toEqual([]);
  });

  it('starts the next round empty', () => {
    const { match, keeper, join } = setup();
    const ana = join('Ana');
    keeper.item(item(), { playerKey: ana.player.key });
    match.heist.endRound();
    match.heist.startNextRound();
    match.heist.endRound();
    expect(ana.connection.jsonOf('review')).toHaveLength(1); // not repeated
  });

  it('leaves out the tutorial, questions without a review, and players who left', () => {
    const { match, keeper, join } = setup();
    const ana = join('Ana');
    const ben = join('Ben');
    keeper.item(item({ tutorial: true }), { playerKey: ana.player.key });
    keeper.item(item({ review: undefined as never }), { playerKey: ana.player.key });
    keeper.item(item(), {});
    keeper.item(item(), { playerKey: ben.player.key });
    match.leave(ben.player.id);
    match.heist.endRound();
    expect(ana.connection.jsonOf('review')).toEqual([]);
  });

  it('keeps only the latest questions when a player flips through very many', () => {
    const { match, keeper, join } = setup();
    const ana = join('Ana');
    for (let i = 0; i < 100; i++)
      keeper.item(item({ review: { title: `Q${i}`, story: '', modelSql: 'x' } }), {
        playerKey: ana.player.key,
      });
    match.heist.endRound();
    const items = ana.connection.jsonOf('review')[0]?.items ?? [];
    expect(items).toHaveLength(60);
    expect(items.at(-1)?.title).toBe('Q99');
  });
});
