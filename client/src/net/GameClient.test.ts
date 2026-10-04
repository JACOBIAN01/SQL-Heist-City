import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Flag, PROTOCOL_VERSION, type SnapshotMessage } from '@heist/shared';
import { FakeGameTransport } from '../testing/FakeGameTransport';
import { GameClient } from './GameClient';

let transport: FakeGameTransport;
let clock: number;
let client: GameClient;

const welcome = { t: 'welcome', playerId: 7, tick: 0, tickRate: 20, mapId: 'sandbox' } as const;
const snapshot: SnapshotMessage = {
  t: 'snapshot',
  tick: 1,
  ackSeq: 0,
  self: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flags: Flag.Alive, hp: 100 },
  entities: [],
  removed: [],
};
const command = { seq: 1, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons: 0, viewLagMs: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  transport = new FakeGameTransport();
  client = new GameClient(transport, { name: 'Ana', now: () => clock });
});
afterEach(() => vi.useRealTimers());

describe('GameClient', () => {
  it('joins when the socket opens and plays after the welcome', () => {
    expect(client.status).toBe('connecting');
    transport.open();
    expect(transport.of('join')).toEqual([{ t: 'join', protocol: PROTOCOL_VERSION, name: 'Ana' }]);
    expect(client.status).toBe('joining');
    transport.receive(welcome);
    expect(client.status).toBe('playing');
    expect(client.playerId).toBe(7);
    expect(client.tickRate).toBe(20);
  });

  it('sends input only once playing, and ignores empty batches', () => {
    client.sendInput([command]);
    transport.open();
    client.sendInput([command]);
    expect(transport.of('input')).toHaveLength(0);
    transport.receive(welcome);
    client.sendInput([]);
    client.sendInput([command]);
    expect(transport.of('input')).toHaveLength(1);
  });

  it('notifies listeners of snapshots and events, and stops after unsubscribe', () => {
    const snapshots = vi.fn();
    const events = vi.fn();
    const off = client.subscribe({ snapshot: snapshots, event: events });
    transport.open();
    transport.receive(welcome);
    transport.receive(snapshot);
    transport.receive({ t: 'event', event: { e: 'left', id: 3 } });
    expect(snapshots).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith({ e: 'left', id: 3 });
    off();
    transport.receive(snapshot);
    expect(snapshots).toHaveBeenCalledOnce();
  });

  it('measures round-trip time from pongs and smooths it', () => {
    transport.open();
    transport.receive(welcome);
    const [ping] = transport.of('ping');
    clock += 80;
    transport.receive({ t: 'pong', clientTime: ping?.clientTime ?? 0, tick: 1 });
    expect(client.rttMs).toBe(80);
    clock += 100;
    vi.advanceTimersByTime(1000);
    const second = transport.of('ping')[1];
    clock += 40;
    transport.receive({ t: 'pong', clientTime: second?.clientTime ?? 0, tick: 2 });
    expect(client.rttMs).toBeGreaterThan(40);
    expect(client.rttMs).toBeLessThan(80);
  });

  it('pings every second while playing', () => {
    transport.open();
    transport.receive(welcome);
    vi.advanceTimersByTime(3000);
    expect(transport.of('ping')).toHaveLength(4);
  });

  it('reports closing once and stops pinging', () => {
    const closed = vi.fn();
    client.subscribe({ closed });
    transport.open();
    transport.receive(welcome);
    transport.drop('server full');
    transport.drop('again');
    expect(closed).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledWith('server full');
    expect(client.status).toBe('closed');
    const pings = transport.of('ping').length;
    vi.advanceTimersByTime(5000);
    expect(transport.of('ping')).toHaveLength(pings);
  });

  it('drops a server that sends garbage', () => {
    const closed = vi.fn();
    client.subscribe({ closed });
    transport.open();
    transport.receiveRaw(new Uint8Array([0x7f]));
    expect(transport.closed).toBe(true);
    expect(closed).toHaveBeenCalledWith('bad data from server');
  });
});

describe('GameClient JSON messages', () => {
  const connect = () => {
    transport.open();
    transport.receive(welcome);
  };

  it('sends JSON messages as json frames once playing', () => {
    client.sendJson({ t: 'interact', ref: 1, anchor: 'bank-1:lift:0' });
    expect(transport.of('json')).toEqual([]); // not connected yet: dropped
    connect();
    client.sendJson({ t: 'interact', ref: 2, anchor: 'bank-1:lift:0' });
    expect(transport.of('json').map((m) => JSON.parse(m.text))).toEqual([
      { t: 'interact', ref: 2, anchor: 'bank-1:lift:0' },
    ]);
  });

  it('hands parsed server JSON to listeners and survives garbage', () => {
    connect();
    const seen: unknown[] = [];
    client.subscribe({ json: (m) => seen.push(m) });
    transport.receive({ t: 'json', text: '{"t":"interact_result","ref":1}' });
    transport.receive({ t: 'json', text: '{broken' });
    expect(seen).toEqual([{ t: 'interact_result', ref: 1 }]);
    expect(client.status).toBe('playing');
  });
});
