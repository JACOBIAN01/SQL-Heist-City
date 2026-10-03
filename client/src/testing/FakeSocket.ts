import type { SocketLike } from '../net/WebSocketChallengeApi';

type Listener = (event: { data?: unknown }) => void;

/** Scriptable stand-in for WebSocket: tests decide when it opens and what the "server" says. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  // --- test controls
  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  fail(): void {
    this.emit('error', {});
  }

  reply(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
}
