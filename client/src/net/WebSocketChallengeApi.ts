import {
  isChallengeServerMessage,
  type ChallengeClientMessage,
  type ChallengeServerMessage,
} from '@heist/shared';
import {
  ChallengeConnectionError,
  ChallengeProtocolError,
  type ChallengeApi,
} from './ChallengeApi';

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

type Pending = {
  readonly expect: ChallengeServerMessage['t'];
  readonly resolve: (message: ChallengeServerMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

// Pattern: Adapter — Why: wraps a raw WebSocket (connect-on-demand, request/
// reply matching by `ref`, timeouts, clock sync) behind ChallengeApi's plain
// promises, so the panel code reads like normal async code.
export class WebSocketChallengeApi implements ChallengeApi {
  private socket: SocketLike | null = null;
  private opening: Promise<SocketLike> | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextRef = 1;
  private clockOffset = 0;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly socketFactory: SocketFactory;

  constructor(
    private readonly url: string,
    options: WebSocketChallengeApiOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
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
    const socket = await this.connect();
    const ref = this.nextRef++;
    return new Promise<ChallengeServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(ref);
        reject(new ChallengeConnectionError('the server did not answer in time'));
      }, this.timeoutMs);
      this.pending.set(ref, { expect, resolve, reject, timer });
      try {
        socket.send(JSON.stringify(build(ref)));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(ref);
        reject(new ChallengeConnectionError(err instanceof Error ? err.message : 'send failed'));
      }
    });
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
    if (message.ref === null) return;
    const pending = this.pending.get(message.ref);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.ref);
    if (message.t === 'challenge_error')
      pending.reject(new ChallengeProtocolError(message.message));
    else if (message.t !== pending.expect)
      pending.reject(new ChallengeProtocolError(`unexpected reply ${message.t}`));
    else pending.resolve(message);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
