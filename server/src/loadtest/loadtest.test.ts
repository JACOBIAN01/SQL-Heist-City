import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, DEFAULT_MATCH_SETTINGS, SeededRng, TEST_MAP, type GameMap } from '@heist/shared';
import { attachGameSocket, type GameSocket } from '../game/GameSocket';
import { Match } from '../game/Match';
import { WanderBrain } from './BotBrain';
import { makeBenchMap } from './benchMap';
import { formatBench } from './format';
import { runHeadlessBench } from './HeadlessBench';
import { summarise } from './percentiles';
import { runSocketBots } from './SocketBots';

const overlaps = (m: GameMap, x: number, z: number) =>
  m.boxes.some((b) => x > b.minX - 0.6 && x < b.maxX + 0.6 && z > b.minZ - 0.6 && z < b.maxZ + 0.6);

describe('summarise', () => {
  it('computes mean, percentiles and max', () => {
    const s = summarise(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s).toMatchObject({ count: 100, mean: 50.5, p50: 51, p95: 96, p99: 100, max: 100 });
  });
  it('is all zero when empty', () => {
    expect(summarise([]).max).toBe(0);
  });
});

describe('WanderBrain', () => {
  const run = (seed: string, fireRate = 0) => {
    const b = new WanderBrain(new SeededRng(seed), { fireRate });
    return Array.from({ length: 300 }, () => b.next());
  };

  it('is deterministic per seed and differs between seeds', () => {
    expect(run('a')).toEqual(run('a'));
    expect(run('a')).not.toEqual(run('b'));
  });

  it('only fires when asked to', () => {
    expect(run('a', 0).some((i) => i.buttons & Button.Fire)).toBe(false);
    expect(run('a', 1).every((i) => i.buttons & Button.Fire)).toBe(true);
  });

  it('always walks forward with a wire-quantised yaw', () => {
    for (const i of run('a')) expect(i.moveY).toBe(127);
  });
});

describe('makeBenchMap', () => {
  it('is deterministic, city-sized, and every spawn point is clear of buildings', () => {
    const a = makeBenchMap(320, 'x');
    expect(makeBenchMap(320, 'x').boxes).toEqual(a.boxes);
    expect(a.boxes.length).toBeGreaterThan(100);
    expect(a.halfSize).toBe(320);
    for (const s of a.spawns) expect(overlaps(a, s.x, s.z)).toBe(false);
  });
});

describe('runHeadlessBench', () => {
  it('runs a match of bots and reports timing and bandwidth', () => {
    const r = runHeadlessBench({ players: 10, map: TEST_MAP, seconds: 1, warmupSeconds: 0.5 });
    expect(r.players).toBe(10);
    expect(r.ticks).toBe(20);
    expect(r.tickMs.count).toBe(20);
    expect(r.tickMs.max).toBeGreaterThan(0);
    expect(r.bytesPerClientPerSec).toBeGreaterThan(1000);
  });

  it('formats a markdown table', () => {
    const r = runHeadlessBench({ players: 4, map: TEST_MAP, seconds: 0.5, warmupSeconds: 0 });
    const text = formatBench([r]);
    expect(text).toContain('| players |');
    expect(text.split('\n')).toHaveLength(3);
  });
});

describe('runSocketBots', () => {
  let http: Server;
  let socket: GameSocket;
  afterEach(async () => {
    await socket.close();
    await new Promise((resolve) => http.close(resolve));
  });

  it('connects real clients, measures bandwidth and round-trip time', async () => {
    http = createServer();
    const match = new Match({
      map: TEST_MAP,
      settings: { ...DEFAULT_MATCH_SETTINGS, sandboxDummies: 0 },
    });
    socket = attachGameSocket(http, match);
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const timer = setInterval(() => match.step(), 50);
    const url = `ws://localhost:${(http.address() as AddressInfo).port}/ws/game`;
    const r = await runSocketBots({ url, players: 4, seconds: 1.5, rampMs: 200 });
    clearInterval(timer);
    expect(r.joined).toBe(4);
    expect(r.failed).toBe(0);
    expect(r.snapshotsPerClientPerSec).toBeGreaterThan(10);
    expect(r.bytesPerClientPerSec).toBeGreaterThan(500);
  }, 15000);
});
