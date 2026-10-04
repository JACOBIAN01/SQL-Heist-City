import {
  CodecError,
  PROTOCOL_VERSION,
  SnapshotDecoder,
  decodeServerMessage,
  encodeClientMessage,
  type GameEvent,
  type InputCommand,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@heist/shared';
import type { GameTransport } from './GameTransport';

export type ConnectionStatus = 'connecting' | 'joining' | 'playing' | 'closed';

/** Everything the rest of the game wants to hear about. All optional: listen to what you need. */
export interface GameClientListener {
  welcome?(message: WelcomeMessage): void;
  snapshot?(message: SnapshotMessage): void;
  event?(event: GameEvent): void;
  closed?(reason: string): void;
}

export interface GameClientOptions {
  readonly name: string;
  readonly now?: () => number;
  readonly pingIntervalMs?: number;
}

const RTT_SMOOTHING = 0.2;

/**
 * Game-connection client: joins, sends input, measures round-trip time, and
 * fans decoded server messages out to listeners (Observer — Why: prediction,
 * interpolation, HUD and audio each react to snapshots without knowing each other).
 */
export class GameClient {
  status: ConnectionStatus = 'connecting';
  playerId = 0;
  tickRate = 20;
  /** Smoothed round-trip time, ms (0 until the first pong). */
  rttMs = 0;
  private readonly listeners = new Set<GameClientListener>();
  /** Rebuilds absolute player states from the server's change-only snapshots. */
  private readonly snapshots = new SnapshotDecoder();
  private readonly now: () => number;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly transport: GameTransport,
    private readonly options: GameClientOptions,
  ) {
    this.now = options.now ?? (() => performance.now());
    transport.onOpen(() => this.handleOpen());
    transport.onMessage((bytes) => this.handleMessage(bytes));
    transport.onClose((reason) => this.handleClose(reason));
  }

  subscribe(listener: GameClientListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendInput(commands: readonly InputCommand[]): void {
    if (this.status !== 'playing' || commands.length === 0) return;
    this.transport.send(encodeClientMessage({ t: 'input', commands }));
  }

  close(): void {
    this.transport.close();
    this.handleClose('left');
  }

  private handleOpen(): void {
    this.status = 'joining';
    this.transport.send(
      encodeClientMessage({ t: 'join', protocol: PROTOCOL_VERSION, name: this.options.name }),
    );
  }

  private handleMessage(bytes: Uint8Array): void {
    let message;
    try {
      message = decodeServerMessage(bytes, this.snapshots);
    } catch (error) {
      if (!(error instanceof CodecError)) throw error;
      this.transport.close();
      this.handleClose('bad data from server');
      return;
    }
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId;
        this.tickRate = message.tickRate;
        this.status = 'playing';
        this.startPinging();
        for (const l of this.listeners) l.welcome?.(message);
        break;
      case 'snapshot':
        for (const l of this.listeners) l.snapshot?.(message);
        break;
      case 'event':
        for (const l of this.listeners) l.event?.(message.event);
        break;
      case 'pong': {
        const sample = Math.max(0, this.now() - message.clientTime);
        this.rttMs = this.rttMs === 0 ? sample : this.rttMs + (sample - this.rttMs) * RTT_SMOOTHING;
        break;
      }
    }
  }

  private handleClose(reason: string): void {
    if (this.status === 'closed') return;
    this.status = 'closed';
    clearInterval(this.pingTimer);
    for (const l of this.listeners) l.closed?.(reason);
  }

  private startPinging(): void {
    const send = () =>
      this.transport.send(encodeClientMessage({ t: 'ping', clientTime: this.now() }));
    send();
    this.pingTimer = setInterval(send, this.options.pingIntervalMs ?? 1000);
  }
}
