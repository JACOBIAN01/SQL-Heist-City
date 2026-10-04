import { SnapshotDecoder, decodeServerMessage, type ServerMessage } from '@heist/shared';
import type { PlayerConnection } from './Player';

/** Records what the server sent, decoded, so tests assert on messages not bytes. */
export class FakeConnection implements PlayerConnection {
  readonly sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | undefined;
  /** Like a real client: snapshots are deltas against what it has received so far. */
  private readonly snapshots = new SnapshotDecoder();

  send(bytes: Uint8Array): void {
    this.sent.push(decodeServerMessage(bytes, this.snapshots));
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  of<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === type);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
