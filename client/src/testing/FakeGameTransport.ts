import {
  decodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@heist/shared';
import type { GameTransport } from '../net/GameTransport';

/** In-memory transport: tests play the server by calling `receive`, and read what the client sent. */
export class FakeGameTransport implements GameTransport {
  readonly sent: ClientMessage[] = [];
  closed = false;
  private openListeners: (() => void)[] = [];
  private messageListeners: ((bytes: Uint8Array) => void)[] = [];
  private closeListeners: ((reason: string) => void)[] = [];

  send(bytes: Uint8Array): void {
    this.sent.push(decodeClientMessage(bytes));
  }
  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
  }
  onMessage(listener: (bytes: Uint8Array) => void): void {
    this.messageListeners.push(listener);
  }
  onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }
  close(): void {
    this.closed = true;
  }

  // --- test controls
  open(): void {
    for (const l of this.openListeners) l();
  }
  receive(message: ServerMessage): void {
    const bytes = encodeServerMessage(message);
    for (const l of this.messageListeners) l(bytes);
  }
  receiveRaw(bytes: Uint8Array): void {
    for (const l of this.messageListeners) l(bytes);
  }
  drop(reason = 'gone'): void {
    for (const l of this.closeListeners) l(reason);
  }
  of<T extends ClientMessage['t']>(type: T): Extract<ClientMessage, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { t: T }> => m.t === type);
  }
}
