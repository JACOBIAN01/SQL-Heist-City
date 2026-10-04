import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  SIM_DT,
  SeededRng,
  SnapshotDecoder,
  decodeServerMessage,
  encodeClientMessage,
  seedOf,
  type InputCommand,
} from '@heist/shared';
import { WanderBrain } from './BotBrain';
import { summarise, type Summary } from './percentiles';

export interface SocketBotOptions {
  readonly url: string;
  readonly players: number;
  readonly seconds: number;
  readonly fireRate?: number;
  readonly seed?: string;
  /** Spread joins over this long so the server is not hit by one burst (ms). */
  readonly rampMs?: number;
}

export interface SocketBotResult {
  readonly joined: number;
  readonly failed: number;
  readonly rttMs: Summary;
  /** Bytes received per second, averaged over all bots. */
  readonly bytesPerClientPerSec: number;
  readonly snapshotsPerClientPerSec: number;
}

/**
 * Real WebSocket clients against a running server: measures what a client
 * actually receives (bandwidth, snapshot rate) and round-trip time.
 */
export async function runSocketBots(options: SocketBotOptions): Promise<SocketBotResult> {
  const seed = options.seed ?? 'socket-bots';
  const rtts: number[] = [];
  let bytes = 0;
  let snapshots = 0;
  let joined = 0;
  let failed = 0;
  const sockets: WebSocket[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];

  const start = (index: number) =>
    new Promise<void>((resolve) => {
      const ws = new WebSocket(options.url);
      sockets.push(ws);
      let seq = 0;
      const brain = new WanderBrain(new SeededRng(seedOf(seed, index)), {
        fireRate: options.fireRate ?? 0,
      });
      let measuring = false;
      const snapshotState = new SnapshotDecoder();
      ws.on('open', () =>
        ws.send(
          encodeClientMessage({ t: 'join', protocol: PROTOCOL_VERSION, name: `bot-${index}` }),
        ),
      );
      ws.on('message', (data: Buffer) => {
        if (measuring) bytes += data.length;
        const message = decodeServerMessage(new Uint8Array(data), snapshotState);
        if (message.t === 'welcome') {
          joined++;
          measuring = true;
          timers.push(
            setInterval(
              () => {
                const commands: InputCommand[] = [];
                for (let i = 0; i < 3; i++) {
                  seq = (seq + 1) & 0xffff;
                  commands.push({ seq, ...brain.next() });
                }
                ws.send(encodeClientMessage({ t: 'input', commands }));
              },
              3 * SIM_DT * 1000,
            ),
            setInterval(
              () => ws.send(encodeClientMessage({ t: 'ping', clientTime: performance.now() })),
              1000,
            ),
          );
          resolve();
        } else if (message.t === 'snapshot' && measuring) {
          snapshots++;
        } else if (message.t === 'pong') {
          rtts.push(performance.now() - message.clientTime);
        }
      });
      ws.on('close', () => {
        if (!measuring) failed++;
        resolve();
      });
      ws.on('error', () => {
        failed++;
        resolve();
      });
    });

  const gap = (options.rampMs ?? 2000) / Math.max(1, options.players);
  const starts: Promise<void>[] = [];
  for (let i = 0; i < options.players; i++) {
    starts.push(start(i));
    await new Promise((r) => setTimeout(r, gap));
  }
  await Promise.all(starts);
  bytes = 0;
  snapshots = 0;
  rtts.length = 0;
  await new Promise((r) => setTimeout(r, options.seconds * 1000));

  for (const t of timers) clearInterval(t);
  for (const s of sockets) s.terminate();
  const clients = Math.max(1, joined);
  return {
    joined,
    failed,
    rttMs: summarise(rtts),
    bytesPerClientPerSec: bytes / clients / options.seconds,
    snapshotsPerClientPerSec: snapshots / clients / options.seconds,
  };
}
