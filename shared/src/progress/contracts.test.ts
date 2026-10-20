import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  progressionSettingsSchema,
} from '../config/progression';
import {
  advanceContracts,
  contractViews,
  contractXp,
  countsFor,
  dayOf,
  dealContracts,
  streakAfterFinishing,
  streakOn,
} from './contracts';

const item = (over = {}) => ({
  outcome: 'solved' as const,
  tier: 2,
  topics: ['where'],
  tutorial: false,
  wrongSubmits: 0,
  hintsPaid: 0,
  ...over,
});
const template = (id: string) => {
  const found = S.contracts.templates.find((t) => t.id === id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
};

describe('dealing contracts', () => {
  it('gives the same student the same three on the same day, all different', () => {
    const a = dealContracts('2026-10-20', 7, S);
    expect(a).toEqual(dealContracts('2026-10-20', 7, S));
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
    expect(a.every((c) => c.progress === 0 && !c.done)).toBe(true);
  });

  it('changes with the day and with the student', () => {
    const ids = (day: string, who: number) =>
      dealContracts(day, who, S)
        .map((c) => c.id)
        .join();
    const variety = new Set([
      ids('2026-10-20', 1),
      ids('2026-10-21', 1),
      ids('2026-10-20', 2),
      ids('2026-10-22', 3),
    ]);
    expect(variety.size).toBeGreaterThan(1);
  });

  it('deals fewer if there are fewer templates than the day asks for', () => {
    const few = progressionSettingsSchema.parse({
      contracts: { templates: [{ id: 'a', kind: 'clean', count: 1, xp: 1 }] },
    });
    expect(dealContracts('2026-10-20', 1, few)).toHaveLength(1);
  });
});

describe('what counts', () => {
  it('counts topic, tier and clean contracts by their own rule', () => {
    expect(countsFor(template('filter-3'), item({ topics: ['null'] }), S)).toBe(true);
    expect(countsFor(template('filter-3'), item({ topics: ['join'] }), S)).toBe(false);
    expect(countsFor(template('tier3-2'), item({ tier: 2 }), S)).toBe(false);
    expect(countsFor(template('tier3-2'), item({ tier: 4 }), S)).toBe(true);
    expect(countsFor(template('clean-3'), item({ wrongSubmits: 1 }), S)).toBe(false);
    expect(countsFor(template('clean-3'), item({ hintsPaid: 1 }), S)).toBe(false);
    expect(countsFor(template('clean-3'), item(), S)).toBe(true);
  });

  it('never counts the tutorial, tests or unsolved questions', () => {
    expect(countsFor(template('clean-3'), item({ tutorial: true }), S)).toBe(false);
    expect(countsFor(template('clean-3'), item({ assessment: 'pre' }), S)).toBe(false);
    for (const outcome of ['abandoned', 'expired', 'died', 'switched'])
      expect(countsFor(template('clean-3'), item({ outcome }), S)).toBe(false);
    expect(countsFor(template('clean-3'), item({ outcome: 'answered', share: 0.5 }), S)).toBe(
      false,
    );
    expect(countsFor(template('clean-3'), item({ outcome: 'answered', share: 1 }), S)).toBe(true);
  });
});

describe('progress and completion', () => {
  it('fills a contract one question at a time and says when it is done, once', () => {
    let state = [{ id: 'clean-3', progress: 0, done: false }];
    const done: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = advanceContracts(state, item(), S);
      state = r.state;
      done.push(...r.completed);
    }
    expect(state[0]).toEqual({ id: 'clean-3', progress: 3, done: true });
    expect(done).toEqual(['clean-3']);
  });

  it('only advances contracts the question counts for', () => {
    const state = [
      { id: 'clean-3', progress: 0, done: false },
      { id: 'windows-2', progress: 0, done: false },
    ];
    const r = advanceContracts(state, item({ topics: ['window'], tier: 5 }), S);
    expect(r.state.map((c) => c.progress)).toEqual([1, 1]);
    expect(
      advanceContracts(state, item({ wrongSubmits: 1, topics: ['join'] }), S).state.map(
        (c) => c.progress,
      ),
    ).toEqual([0, 0]);
  });

  it('describes a day for the client, with the skill named', () => {
    const v = contractViews([{ id: 'joins-3', progress: 1, done: false }], S);
    expect(v).toEqual([
      { id: 'joins-3', kind: 'topic', skill: 'Joins', count: 3, xp: 60, progress: 1, done: false },
    ]);
  });
});

describe('day streak', () => {
  it('adds a day for each consecutive day, restarts after a gap, ignores a second finish the same day', () => {
    let st = streakAfterFinishing({ days: 0, lastDay: '' }, '2026-10-20');
    expect(st).toEqual({ days: 1, lastDay: '2026-10-20' });
    expect(streakAfterFinishing(st, '2026-10-20')).toBe(st);
    st = streakAfterFinishing(st, '2026-10-21');
    expect(st.days).toBe(2);
    st = streakAfterFinishing(st, '2026-10-23');
    expect(st).toEqual({ days: 1, lastDay: '2026-10-23' });
  });

  it('shows a run as alive until a full day is missed', () => {
    const st = { days: 4, lastDay: '2026-10-20' };
    expect(streakOn(st, '2026-10-20')).toBe(4);
    expect(streakOn(st, '2026-10-21')).toBe(4); // today still to finish
    expect(streakOn(st, '2026-10-22')).toBe(0);
    expect(streakOn({ days: 0, lastDay: '' }, '2026-10-22')).toBe(0);
  });

  it('pays more XP for a longer run, up to a cap', () => {
    const t = template('joins-3'); // 60 XP
    expect(contractXp(t, 1, S)).toBe(60);
    expect(contractXp(t, 3, S)).toBe(72);
    expect(contractXp(t, 99, S)).toBe(Math.round(60 * (1 + 0.1 * 7)));
  });

  it('reads the day from a time (UTC)', () => {
    expect(dayOf(Date.UTC(2026, 9, 20, 23, 59))).toBe('2026-10-20');
    expect(dayOf(Date.UTC(2026, 9, 21, 0, 0))).toBe('2026-10-21');
  });
});

describe('the shipped contracts', () => {
  it('only point at skills that exist, and fit in a short session', () => {
    const nodes = new Set(S.skills.tree.map((n) => n.id));
    for (const t of S.contracts.templates) {
      if (t.kind === 'topic') expect(nodes.has(t.skill ?? ''), t.id).toBe(true);
      expect(t.count, t.id).toBeLessThanOrEqual(5);
    }
  });
});
