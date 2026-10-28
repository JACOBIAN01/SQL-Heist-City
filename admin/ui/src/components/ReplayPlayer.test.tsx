import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RoundReplay } from '@heist/shared';
import { ReplayPlayer } from './ReplayPlayer';

const replay: RoundReplay = {
  step: 3,
  seconds: 30,
  tracks: [
    { name: 'Ana', from: 0, points: [0, 0, 10, 10] },
    { name: 'Ben', from: 1, points: [4, 4] },
  ],
  events: [
    { at: 5, kind: 'kill', who: 'Ana', other: 'Ben' },
    { at: 20, kind: 'banked', who: 'Ben', text: '1500' },
  ],
};

describe('ReplayPlayer', () => {
  it('scrubs through the round and says what just happened', () => {
    render(<ReplayPlayer replay={replay} />);
    expect(screen.getByText('1 students on the map')).toBeTruthy();
    expect(screen.queryByText(/put Ben down/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Time in the round'), { target: { value: '6' } });
    expect(screen.getByText('2 students on the map')).toBeTruthy();
    expect(screen.getByText(/Ana put Ben down/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Time in the round'), { target: { value: '21' } });
    expect(screen.getByText(/Ben banked \$1,500/)).toBeTruthy();
  });
});
