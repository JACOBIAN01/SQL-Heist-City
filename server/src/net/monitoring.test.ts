import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPrometheus } from './prometheus';

const file = (p: string) =>
  readFileSync(new URL(`../../../deploy/monitoring/${p}`, import.meta.url), 'utf8');

const game = {
  players: 1,
  tick: 1,
  tickMs: { p50: 1, p95: 1, p99: 1, max: 1 },
  bytesPerSecond: 1,
  snapshotsPerSecond: 1,
  bytesPerPlayerPerSecond: 1,
  anomalies: { speed: 1 },
};
const exposed = new Set(
  [
    ...renderPrometheus({
      uptimeSeconds: 1,
      matches: { main: game },
      sandbox: {
        slots: 1,
        busy: 0,
        queued: 0,
        jobs: 0,
        timeouts: 0,
        demoted: 0,
        waitMs: { p50: 0, p95: 0, max: 0 },
      },
      rssBytes: 1,
      heapBytes: 1,
    }).matchAll(/^# TYPE (\w+) /gm),
  ].map((m) => m[1]),
);

const metricsIn = (text: string) => [...text.matchAll(/\bheist_\w+/g)].map((m) => m[0]);

describe('monitoring files match what the server exposes (20.4)', () => {
  it('every metric an alert rule uses exists', () => {
    const used = new Set(metricsIn(file('alerts.yml')));
    expect(used.size).toBeGreaterThan(4);
    expect([...used].filter((m) => !exposed.has(m))).toEqual([]);
  });

  it('every metric the dashboard plots exists, and it is valid JSON with unique panel ids', () => {
    const text = file('grafana/dashboards/heist.json');
    const dash = JSON.parse(text) as { panels: { id: number; targets: { expr: string }[] }[] };
    expect([...new Set(metricsIn(text))].filter((m) => !exposed.has(m))).toEqual([]);
    const ids = dash.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of dash.panels) expect(p.targets.length).toBeGreaterThan(0);
  });
});
