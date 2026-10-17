import type { SandboxStats } from '../sql/WorkerSandboxRunner';
import type { GameMetrics } from '../game/startGame';

/** What one scrape reports: the matches (open play and class rooms), the grader and the process. */
export interface MetricsSnapshot {
  readonly uptimeSeconds: number;
  /** Label for the match (`main`, or the match id) → its latest numbers (none yet = left out). */
  readonly matches: Readonly<Record<string, GameMetrics | undefined>>;
  readonly sandbox?: SandboxStats | undefined;
  /** Error reports received from browsers since the server started. */
  readonly clientErrors?: number;
  readonly rssBytes?: number;
  readonly heapBytes?: number;
}

const escapeLabel = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/**
 * The numbers in Prometheus' text format (Phase 20.4), for dashboards and alerts. Gauges only
 * (the tick time is the recent 95th/99th percentile the game already keeps).
 */
export function renderPrometheus(m: MetricsSnapshot): string {
  const out: string[] = [];
  const gauge = (name: string, help: string, samples: [Record<string, string>, number][]) => {
    if (samples.length === 0) return;
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const [labels, value] of samples) {
      const l = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
        .join(',');
      out.push(`${name}${l ? `{${l}}` : ''} ${Number.isFinite(value) ? value : 0}`);
    }
  };
  const perMatch = (pick: (g: GameMetrics) => number, extra: Record<string, string> = {}) =>
    Object.entries(m.matches).flatMap(([match, g]): [Record<string, string>, number][] =>
      g ? [[{ match, ...extra }, pick(g)]] : [],
    );

  gauge('heist_uptime_seconds', 'Seconds since the server started.', [[{}, m.uptimeSeconds]]);
  gauge(
    'heist_players',
    'Players connected to a match.',
    perMatch((g) => g.players),
  );
  gauge(
    'heist_tick',
    'Ticks since the match started.',
    perMatch((g) => g.tick),
  );
  gauge('heist_tick_ms', 'Time one tick takes (ms), recent window.', [
    ...perMatch((g) => g.tickMs.p50, { quantile: '0.5' }),
    ...perMatch((g) => g.tickMs.p95, { quantile: '0.95' }),
    ...perMatch((g) => g.tickMs.p99, { quantile: '0.99' }),
    ...perMatch((g) => g.tickMs.max, { quantile: '1' }),
  ]);
  gauge(
    'heist_bytes_per_second',
    'Bytes sent to all players per second.',
    perMatch((g) => g.bytesPerSecond),
  );
  gauge(
    'heist_bytes_per_player_per_second',
    'Bytes sent to one player per second.',
    perMatch((g) => g.bytesPerPlayerPerSecond),
  );
  gauge(
    'heist_anomalies',
    'Things an honest client never does, since the match started.',
    Object.entries(m.matches).flatMap(([match, g]): [Record<string, string>, number][] =>
      Object.entries(g?.anomalies ?? {}).map(([kind, n]): [Record<string, string>, number] => [
        { match, kind },
        n ?? 0,
      ]),
    ),
  );
  if (m.sandbox) {
    const s = m.sandbox;
    gauge('heist_grader_slots', 'Sandbox processes grading student SQL.', [[{}, s.slots]]);
    gauge('heist_grader_busy', 'Sandbox processes grading right now.', [[{}, s.busy]]);
    gauge('heist_grader_queue', 'Jobs waiting for a sandbox process.', [[{}, s.queued]]);
    gauge('heist_grader_jobs', 'Jobs started since the server began.', [[{}, s.jobs]]);
    gauge('heist_grader_timeouts', 'Jobs stopped by the time limit since the server began.', [
      [{}, s.timeouts],
    ]);
    gauge('heist_grader_demoted', 'Jobs moved to the slow lane since the server began.', [
      [{}, s.demoted],
    ]);
    gauge('heist_grader_wait_ms', 'How long jobs waited for a process (ms), last 500.', [
      [{ quantile: '0.5' }, s.waitMs.p50],
      [{ quantile: '0.95' }, s.waitMs.p95],
      [{ quantile: '1' }, s.waitMs.max],
    ]);
  }
  if (m.clientErrors !== undefined)
    gauge('heist_client_errors', 'Error reports received from browsers since the server started.', [
      [{}, m.clientErrors],
    ]);
  if (m.rssBytes !== undefined)
    gauge('heist_process_rss_bytes', 'Memory the process holds.', [[{}, m.rssBytes]]);
  if (m.heapBytes !== undefined)
    gauge('heist_process_heap_bytes', 'JavaScript heap in use.', [[{}, m.heapBytes]]);
  return `${out.join('\n')}\n`;
}
