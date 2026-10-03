/**
 * Pattern: Adapter — Why: the game code sends and receives byte arrays and
 * never touches WebSocket, so tests use an in-memory transport and the real
 * socket can be wrapped (e.g. with simulated latency) without changes.
 */
export interface GameTransport {
  send(bytes: Uint8Array): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (bytes: Uint8Array) => void): void;
  onClose(listener: (reason: string) => void): void;
  close(): void;
}

export class WebSocketGameTransport implements GameTransport {
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
  }

  send(bytes: Uint8Array): void {
    if (this.socket.readyState === WebSocket.OPEN)
      // Our encoders always allocate a plain ArrayBuffer; TS cannot see that through Uint8Array's default type.
      this.socket.send(bytes as Uint8Array<ArrayBuffer>);
  }

  onOpen(listener: () => void): void {
    this.socket.addEventListener('open', listener);
  }

  onMessage(listener: (bytes: Uint8Array) => void): void {
    this.socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) listener(new Uint8Array(event.data));
    });
  }

  onClose(listener: (reason: string) => void): void {
    this.socket.addEventListener('close', (event) =>
      listener(event.reason || `closed (${event.code})`),
    );
    this.socket.addEventListener('error', () => listener('connection failed'));
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * Pattern: Decorator — Why: adds artificial one-way latency to any transport so
 * prediction and interpolation can be tried at 100 ms (`?lag=100`) on a local
 * server, without the game knowing.
 */
export class DelayedTransport implements GameTransport {
  constructor(
    private readonly inner: GameTransport,
    private readonly delayMs: number,
  ) {}

  send(bytes: Uint8Array): void {
    const copy = bytes.slice();
    setTimeout(() => this.inner.send(copy), this.delayMs);
  }

  onOpen(listener: () => void): void {
    this.inner.onOpen(listener);
  }

  onMessage(listener: (bytes: Uint8Array) => void): void {
    this.inner.onMessage((bytes) => setTimeout(() => listener(bytes), this.delayMs));
  }

  onClose(listener: (reason: string) => void): void {
    this.inner.onClose(listener);
  }

  close(): void {
    this.inner.close();
  }
}
