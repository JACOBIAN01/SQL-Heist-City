import { describe, expect, it } from 'vitest';
import { renderPrometheus } from './prometheus';

const game = {
  players: 98,
  tick: 4000,
  tickMs: { p50: 1.5, p95: 2.5, p99: 6, max: 14 },
  bytesPerSecond: 240_000,
  snapshotsPerSecond: 2000,
  bytesPerPlayerPerSecond: 2400,
  anomalies: { speed: 2, fire_rate: 1 },
};

describe('Prometheus text (20.4)', () => {
  it('reports each match with its label, the grader and the process', () => {
    const text = renderPrometheus({
      uptimeSeconds: 120,
      matches: { main: game, 'room "7"': { ...game, players: 3, anomalies: {} } },
      sandbox: {
        slots: 7,
        busy: 2,
        queued: 5,
        jobs: 900,
        timeouts: 3,
        demoted: 4,
        waitMs: { p50: 1, p95: 40, max: 130 },
      },
      rssBytes: 300e6,
    });
    expect(text).toContain('# TYPE heist_players gauge');
    expect(text).toContain('heist_players{match="main"} 98');
    expect(text).toContain('heist_players{match="room \\"7\\""} 3');
    expect(text).toContain('heist_tick_ms{match="main",quantile="0.99"} 6');
    expect(text).toContain('heist_anomalies{match="main",kind="speed"} 2');
    expect(text).toContain('heist_grader_queue 5');
    expect(text).toContain('heist_grader_wait_ms{quantile="0.95"} 40');
    expect(text).toContain('heist_process_rss_bytes 300000000');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('leaves out what has no numbers yet, and never prints NaN', () => {
    const text = renderPrometheus({
      uptimeSeconds: 1,
      matches: { 3: undefined, main: { ...game, bytesPerPlayerPerSecond: Number.NaN } },
    });
    expect(text).not.toContain('match="3"');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('heist_grader');
    for (const line of text.trim().split('\n'))
      expect(line).toMatch(/^(# (HELP|TYPE) \w+ .+|\w+(\{.*\})? -?[\d.e+]+)$/);
  });
});
