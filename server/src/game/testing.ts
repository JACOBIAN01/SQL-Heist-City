import {
  SnapshotDecoder,
  decodeServerMessages,
  type JsonServerMessage,
  type ServerMessage,
} from '@heist/shared';
import type { PlayerConnection } from './Player';

/** Records what the server sent, decoded, so tests assert on messages not bytes. */
export class FakeConnection implements PlayerConnection {
  readonly sent: ServerMessage[] = [];
  /** How many WebSocket frames (send calls) the server used. */
  frames = 0;
  closed: { code: number; reason: string } | undefined;
  /** Like a real client: snapshots are deltas against what it has received so far. */
  private readonly snapshots = new SnapshotDecoder();

  send(bytes: Uint8Array): void {
    this.frames++;
    this.sent.push(...decodeServerMessages(bytes, this.snapshots));
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  of<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === type);
  }

  /** JSON messages received so far, parsed (tasks, interaction results…). */
  json(): JsonServerMessage[] {
    return this.of('json').map((m) => JSON.parse(m.text) as JsonServerMessage);
  }

  jsonOf<T extends JsonServerMessage['t']>(type: T): Extract<JsonServerMessage, { t: T }>[] {
    return this.json().filter((m): m is Extract<JsonServerMessage, { t: T }> => m.t === type);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
