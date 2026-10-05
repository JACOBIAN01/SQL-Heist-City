import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_TUTORIAL_SETTINGS,
  PROTOCOL_VERSION,
  TUTORIAL_MAP,
  TUTORIAL_STEPS,
  TUTORIAL_TARGETS,
  decodeServerMessages,
  encodeClientMessage,
  SnapshotDecoder,
  type JsonServerMessage,
  type TutorialStepId,
} from '@heist/shared';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway, correctAnswer } from '../heist/testing';
import { attachTutorialSocket, TutorialRoom, type TutorialSocket } from './TutorialRooms';

const deps = (gateway = new ScriptedGateway()) => ({
  settings: DEFAULT_TUTORIAL_SETTINGS,
  match: DEFAULT_MATCH_SETTINGS,
  heist: DEFAULT_HEIST_SETTINGS,
  combat: () => ({ ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 }),
  challenges: gateway,
});

const stepIndex = (id: TutorialStepId) => TUTORIAL_STEPS.findIndex((s) => s.id === id);

function setup() {
  const gateway = new ScriptedGateway();
  const room = new TutorialRoom(deps(gateway), 'tutorial-1');
  const connection = new FakeConnection();
  const r = room.match.join(PROTOCOL_VERSION, 'Newbie', connection);
  if (!r.ok) throw new Error('join failed');
  room.coach.onJoin(r.player);
  const player = r.player;
  const steps = () => connection.jsonOf('tutorial').map((m) => m.step);
  const at = (target: { x: number; y: number; z: number } | undefined) => {
    if (!target) throw new Error('no target');
    room.match.teleport(player, target.x, target.y, target.z);
    room.step();
  };
  const solve = async (rewardKey: string) => {
    gateway.answer = (raw) => correctAnswer(raw.ref, rewardKey);
    room.match.receiveJson(
      player.id,
      JSON.stringify({ t: 'challenge_submit', ref: 9, challengeId: 'c', sql: 'x' }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    room.step();
  };
  return { room, player, connection, steps, at, solve };
}

describe('tutorial room', () => {
  it('is a private match on the tutorial map, with practice targets and its own player keys', () => {
    const { room, player } = setup();
    expect(room.match.map).toBe(TUTORIAL_MAP);
    expect(room.match.players.size).toBe(1 + (TUTORIAL_MAP.dummies?.length ?? 0));
    expect(player.key).toBe('tutorial-1:p1');
    expect(room.match.heist.settings.locksPerVault).toBe(1);
    expect(room.match.heist.settings.killBonus).toBe(0);
  });

  it('starts the player hurt, on step one', () => {
    const { player, steps } = setup();
    expect(player.hp).toBe(DEFAULT_TUTORIAL_SETTINGS.startHp);
    expect(steps()).toEqual([0]);
  });

  it('takes a new player through every step to the end', async () => {
    const s = setup();
    s.at(TUTORIAL_TARGETS.move);
    expect(s.steps().at(-1)).toBe(stepIndex('heal'));

    await s.solve('heal:small');
    expect(s.steps().at(-1)).toBe(stepIndex('gun'));

    await s.solve('gun:pistol');
    expect(s.player.arsenal.has('pistol')).toBe(true);
    expect(s.steps().at(-1)).toBe(stepIndex('shoot'));

    const target = [...s.room.match.players.values()].find((p) => p.isDummy);
    if (!target) throw new Error('no target');
    s.room.match.damage(target, 500, s.player);
    s.room.step();
    expect(s.player.cash).toBe(0); // targets pay nothing
    expect(s.steps().at(-1)).toBe(stepIndex('vault'));

    const vault = TUTORIAL_MAP.vaults?.[0];
    if (!vault) throw new Error('no vault');
    s.room.match.heist.openLock(vault.id, 1); // the one lock
    s.room.step();
    expect(s.steps().at(-1)).toBe(stepIndex('loot'));

    s.at(TUTORIAL_TARGETS.loot);
    expect(s.player.cash).toBeGreaterThan(0);
    expect(s.steps().at(-1)).toBe(stepIndex('bank'));

    const pad = TUTORIAL_MAP.anchors?.find((a) => a.kind === 'safehouse');
    if (!pad) throw new Error('no safehouse');
    s.at(pad);
    s.room.match.heist.banking.start(s.player, pad);
    for (let i = 0; i < DEFAULT_HEIST_SETTINGS.bankingSeconds * 20 + 2; i++) s.room.step();
    expect(s.player.banked).toBeGreaterThan(0);
    expect(s.steps().at(-1)).toBe(TUTORIAL_STEPS.length);
    // Each step was announced once, in order.
    expect(s.steps()).toEqual(TUTORIAL_STEPS.map((_, i) => i).concat(TUTORIAL_STEPS.length));
  });

  it('counts a step done early when its turn comes', async () => {
    const s = setup();
    await s.solve('gun:pistol'); // before walking to the marker or healing
    expect(s.steps().at(-1)).toBe(0);
    s.at(TUTORIAL_TARGETS.move);
    await s.solve('heal:small');
    expect(s.steps().at(-1)).toBe(stepIndex('shoot'));
  });

  it('does not count a heal that was not solved (healing is the SQL task, not the hit points)', () => {
    const s = setup();
    s.at(TUTORIAL_TARGETS.move);
    s.player.hp = DEFAULT_COMBAT_SETTINGS.maxHp;
    s.room.step();
    expect(s.steps().at(-1)).toBe(stepIndex('heal'));
  });
});

describe('tutorial socket', () => {
  let http: Server | undefined;
  let socket: TutorialSocket | undefined;
  const clients: WebSocket[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.terminate();
    await socket?.close();
    if (http) await new Promise((resolve) => http?.close(resolve));
  });

  async function serve(maxRooms: number) {
    http = createServer();
    socket = attachTutorialSocket(http, {
      ...deps(),
      settings: { ...DEFAULT_TUTORIAL_SETTINGS, maxRooms },
    });
    await new Promise<void>((resolve) => http?.listen(0, resolve));
    return `ws://localhost:${(http.address() as AddressInfo).port}/ws/tutorial`;
  }

  async function connect(url: string) {
    const ws = new WebSocket(url);
    clients.push(ws);
    const json: JsonServerMessage[] = [];
    let mapId = '';
    const decoder = new SnapshotDecoder();
    ws.on('message', (data: Buffer) => {
      for (const m of decodeServerMessages(new Uint8Array(data), decoder)) {
        if (m.t === 'welcome') mapId = m.mapId;
        if (m.t === 'json') json.push(JSON.parse(m.text) as JsonServerMessage);
      }
    });
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.send(encodeClientMessage({ t: 'join', protocol: PROTOCOL_VERSION, name: 'Newbie' }));
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
    };
    return { ws, json, closed, until, mapId: () => mapId };
  }

  it('gives every connection its own tutorial, and closes it when they leave', async () => {
    const url = await serve(5);
    const a = await connect(url);
    const b = await connect(url);
    await a.until(() => a.json.some((m) => m.t === 'tutorial'));
    await b.until(() => b.json.some((m) => m.t === 'tutorial'));
    expect(a.mapId()).toBe('tutorial');
    expect(a.json.find((m) => m.t === 'tutorial')).toEqual({ t: 'tutorial', step: 0 });
    expect(socket?.rooms).toBe(2);
    a.ws.close();
    await a.closed;
    await b.until(() => socket?.rooms === 1);
    expect(socket?.rooms).toBe(1);
  });

  it('turns players away when every room is busy', async () => {
    const url = await serve(1);
    const a = await connect(url);
    await a.until(() => a.json.length > 0);
    const b = await connect(url);
    expect(await b.closed).toBe(4001);
  });
});
