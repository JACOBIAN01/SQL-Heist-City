import {
  isChallengeServerMessage,
  type ChallengeClientMessage,
  type ChallengeServerMessage,
} from '@heist/shared';
import { ChallengeConnectionError, type ChallengeApi } from './ChallengeApi';
import { JsonRpc } from './JsonRpc';

/** The slice of WebSocket we use; tests provide a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface WebSocketChallengeApiOptions {
  readonly socketFactory?: SocketFactory;
  /** How long to wait for a reply before giving up. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

const OPEN = 1;

// Pattern: Adapter — Why: wraps a raw WebSocket (connect-on-demand, request/
// reply matching by `ref`, timeouts, clock sync) behind ChallengeApi's plain
// promises, so the panel code reads like normal async code.
export class WebSocketChallengeApi implements ChallengeApi {
  private socket: SocketLike | null = null;
  private opening: Promise<SocketLike> | null = null;
  private readonly rpc: JsonRpc<ChallengeClientMessage, ChallengeServerMessage>;
  private clockOffset = 0;
  private readonly now: () => number;
  private readonly socketFactory: SocketFactory;

  constructor(
    private readonly url: string,
    options: WebSocketChallengeApiOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.rpc = new JsonRpc(
      (message) => this.socket?.send(JSON.stringify(message)),
      options.timeoutMs,
    );
    this.socketFactory =
      options.socketFactory ?? ((u) => new WebSocket(u) as unknown as SocketLike);
  }

  async request(rewardKey: string, target?: string) {
    const reply = await this.call('challenge', (ref) => ({
      t: 'challenge_request',
      ref,
      rewardKey,
      ...(target === undefined ? {} : { target }),
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge' }>).result;
  }

  async run(challengeId: string, sql: string) {
    const reply = await this.call('challenge_preview', (ref) => ({
      t: 'challenge_run',
      ref,
      challengeId,
      sql,
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge_preview' }>).result;
  }

  async submit(challengeId: string, sql: string) {
    const reply = await this.call('challenge_result', (ref) => ({
      t: 'challenge_submit',
      ref,
      challengeId,
      sql,
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge_result' }>).result;
  }

  async hint(challengeId: string, index: number) {
    const reply = await this.call('challenge_hint', (ref) => ({
      t: 'challenge_hint',
      ref,
      challengeId,
      index,
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge_hint' }>).result;
  }

  async abandon(): Promise<void> {
    await this.call('challenge_abandoned', (ref) => ({ t: 'challenge_abandon', ref }));
  }

  serverNow(): number {
    return this.now() + this.clockOffset;
  }

  close(): void {
    this.socket?.close();
    this.failAll(new ChallengeConnectionError('connection closed'));
    this.socket = null;
    this.opening = null;
  }

  private async call(
    expect: ChallengeServerMessage['t'],
    build: (ref: number) => ChallengeClientMessage,
  ): Promise<ChallengeServerMessage> {
    await this.connect();
    return this.rpc.call(expect, build);
  }

  private connect(): Promise<SocketLike> {
    if (this.socket?.readyState === OPEN) return Promise.resolve(this.socket);
    this.opening ??= new Promise<SocketLike>((resolve, reject) => {
      const socket = this.socketFactory(this.url);
      socket.addEventListener('open', () => {
        this.socket = socket;
        resolve(socket);
      });
      socket.addEventListener('error', () => {
        this.opening = null;
        reject(new ChallengeConnectionError('could not reach the game server'));
      });
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.socket = null;
        this.opening = null;
        this.failAll(new ChallengeConnectionError('the connection to the game server closed'));
        reject(new ChallengeConnectionError('the connection to the game server closed'));
      });
      socket.addEventListener('message', (event) => this.onMessage(event.data));
    });
    return this.opening;
  }

  private onMessage(data: unknown): void {
    let message: unknown;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!isChallengeServerMessage(message)) return;
    this.clockOffset = message.now - this.now();
    this.rpc.handle(message, 'challenge_error', (m) =>
      m.t === 'challenge_error' ? m.message : 'server error',
    );
  }

  private failAll(error: Error): void {
    this.rpc.failAll(error);
  }
}
