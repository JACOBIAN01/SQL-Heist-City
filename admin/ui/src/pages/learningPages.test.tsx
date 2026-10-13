import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  addItem,
  axisScores,
  emptyTotals,
  lensAxes,
  remediation,
  type ItemRecord,
  type ProfileScopeView,
  type ProfileTotals,
} from '@heist/shared';
import { Radar } from '../components/Radar';
import type { admin } from '../testing/render';
import { fakeApi, renderWithProviders, teacher } from '../testing/render';
import { ClassLearningPage } from './ClassLearningPage';
import { StudentPage } from './StudentPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: 'c',
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'x',
  tier: 1,
  rcsbe: 'S',
  bloom: 'apply',
  marks: 3,
  topics: [],
  outcome: 'solved',
  runs: 1,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 9,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 1,
  ...over,
});
const totals = (rows: Partial<ItemRecord>[]): ProfileTotals =>
  rows.reduce((t, r) => addItem(t, item(r), S), emptyTotals());
const view = (t: ProfileTotals): ProfileScopeView => {
  const rcsbe = axisScores(t, 'rcsbe', S);
  const focus = remediation(rcsbe);
  return {
    rcsbe,
    bloom: axisScores(t, 'bloom', S),
    ...(focus ? { focus: { lens: 'rcsbe' as const, dimension: focus.dimension } } : {}),
  };
};
const strong = totals([{}, {}, {}]);
const weakC = totals(
  [1, 2, 3].map(() => ({
    rcsbe: 'C' as const,
    bloom: 'understand' as const,
    outcome: 'expired' as const,
    submits: 1,
  })),
);

describe('Radar', () => {
  it('draws labels in full, a dashed target, and "not enough data" for thin axes', () => {
    render(
      <Radar
        title="Profile"
        axes={lensAxes('rcsbe')}
        layers={[
          { id: 'me', kind: 'fill', values: [null, 60, 80, null, 40] },
          { id: 'target', kind: 'outline', dashed: true, values: [10, 25, 40, 10, 15] },
        ]}
      />,
    );
    const svg = screen.getByRole('img', { name: 'Profile' });
    expect(svg.textContent).toContain('C · Comprehend');
    expect(svg.textContent?.match(/not enough data/g)).toHaveLength(2);
    expect(svg.querySelectorAll('line[data-thin]')).toHaveLength(2);
    expect(svg.querySelector('g[data-layer="target"] path')?.getAttribute('stroke-dasharray')).toBe(
      '5 3',
    );
  });
});

const analytics = {
  target: S.targetProfile,
  class: view(poolOf(strong, weakC)),
  students: [
    {
      playerId: 2,
      name: 'Ben',
      rcsbe: axisScores(weakC, 'rcsbe', S),
      bloom: axisScores(weakC, 'bloom', S),
    },
    {
      playerId: 1,
      name: 'Ana',
      rcsbe: axisScores(strong, 'rcsbe', S),
      bloom: axisScores(strong, 'bloom', S),
    },
  ],
  spread: {
    rcsbe: ['R', 'C', 'S', 'B', 'E'].map((d) => ({
      dimension: d,
      students: d === 'S' ? 2 : 0,
      min: d === 'S' ? 0 : null,
      q1: null,
      median: d === 'S' ? 50 : null,
      q3: null,
      max: d === 'S' ? 100 : null,
    })),
    bloom: [],
  },
  paper: {
    questions: 12,
    problems: ['Comprehend has no questions, target 25%'],
    rows: ['R', 'C', 'S', 'B', 'E'].map((d) => ({
      dimension: d,
      actual: d === 'S' ? 100 : 0,
      target: S.targetProfile[d as 'R'],
      status: d === 'S' ? 'high' : 'missing',
    })),
  },
};

/** Everyone's marks together (a class profile adds marks, never averages percentages). */
function poolOf(a: ProfileTotals, b: ProfileTotals): ProfileTotals {
  type Tally = { earned: number; available: number; items: number };
  const plus = (x: Tally, y: Tally): Tally => ({
    earned: x.earned + y.earned,
    available: x.available + y.available,
    items: x.items + y.items,
  });
  return {
    rcsbe: Object.fromEntries(
      Object.keys(a.rcsbe).map((k) => [k, plus(a.rcsbe[k as 'S'], b.rcsbe[k as 'S'])]),
    ) as ProfileTotals['rcsbe'],
    bloom: Object.fromEntries(
      Object.keys(a.bloom).map((k) => [k, plus(a.bloom[k as 'apply'], b.bloom[k as 'apply'])]),
    ) as ProfileTotals['bloom'],
  };
}

function api(user: typeof teacher | typeof admin = teacher) {
  return fakeApi({
    'GET /auth/me': () => ({ body: { user } }),
    'GET /classes/7/analytics': () => ({ body: analytics }),
    'GET /classes/7/items': () => ({
      body: {
        items: [
          {
            questionId: 1,
            slug: 'a',
            title: 'Hard one',
            rcsbe: 'S',
            tier: 3,
            attempts: 10,
            students: 10,
            solveRate: 0.1,
            wrongRate: 0.8,
            medianSeconds: 120,
            discrimination: 0.4,
            flags: ['too_hard'],
          },
        ],
      },
    }),
    'GET /classes/7/students/2': () => ({
      body: {
        player: { id: 2, name: 'Ben' },
        profile: view(weakC),
        classProfile: view(strong),
        target: S.targetProfile,
        trend: [
          { round: 1, rcsbe: axisScores(weakC, 'rcsbe', S) },
          { round: 2, rcsbe: axisScores(strong, 'rcsbe', S) },
        ],
        topics: [{ topic: 'group', earned: 0, available: 9, items: 3, solved: 0, score: 0 }],
        weakestTopics: [{ topic: 'group', score: 0 }],
        remediation: axisScores(weakC, 'rcsbe', S).find((a) => a.dimension === 'C'),
        items: 3,
      },
    }),
  });
}

const renderLearning = () =>
  renderWithProviders(
    <Routes>
      <Route path="/classes/:id/learning" element={<ClassLearningPage />} />
    </Routes>,
    '/classes/7/learning',
  );

describe('ClassLearningPage', () => {
  it('shows the class radars and live students weakest first', async () => {
    api();
    renderLearning();
    const user = userEvent.setup();
    expect(await screen.findByRole('img', { name: 'Class RCSBE profile' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Class Bloom profile' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Students' }));
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.includes('/students/'));
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/classes/7/students/2',
      '/classes/7/students/1',
    ]);
    expect(within(links[0] as HTMLElement).getByText(/weakest: Comprehend 0%/)).toBeTruthy();
  });

  it('flags what is wrong with the paper', async () => {
    api();
    renderLearning();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Paper' }));
    expect(screen.getByText('Comprehend has no questions, target 25%')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Question set shape against the target' })).toBeTruthy();
  });

  it('shows the spread and the per-question notes', async () => {
    api();
    renderLearning();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Spread' }));
    expect(screen.getAllByText('S · Solve').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Questions' }));
    expect(await screen.findByText('Hard one')).toBeTruthy();
    expect(screen.getByText('Very few solve it')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('offers the spreadsheet', async () => {
    api();
    renderLearning();
    expect((await screen.findByText('Download profiles (CSV)')).getAttribute('href')).toBe(
      '/api/classes/7/export.csv',
    );
  });
});

describe('StudentPage', () => {
  it('shows the student over the class and target, where to practise, round by round, and topics', async () => {
    api();
    renderWithProviders(
      <Routes>
        <Route path="/classes/:id/students/:playerId" element={<StudentPage />} />
      </Routes>,
      '/classes/7/students/2',
    );
    expect(await screen.findByText('Ben')).toBeTruthy();
    expect(screen.getByText(/Next to work on:/).textContent).toContain('Comprehend');
    expect(screen.getByRole('img', { name: 'RCSBE profile' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Round 1' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Round 2' })).toBeTruthy();
    expect(screen.getByText(/Weakest: group \(0%\)/)).toBeTruthy();
    expect(screen.getAllByText('not enough data').length).toBeGreaterThan(0);
  });
});
