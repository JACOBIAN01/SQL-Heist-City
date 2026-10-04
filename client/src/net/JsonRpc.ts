import { ChallengeConnectionError, ChallengeProtocolError } from './ChallengeApi';

/** A reply the server tagged with the `ref` of the request it answers. */
export interface RpcReply {
  readonly t: string;
  readonly ref: number | null;
}

interface Pending<R extends RpcReply> {
  readonly expect: string;
  readonly resolve: (reply: R) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Request/reply over a message stream: every request gets a `ref`, the reply
 * echoes it, and the caller gets a promise (with a timeout) instead of
 * handling messages by hand. Shared by the SQL panel and interactions, over
 * either the demo socket or the game connection.
 */
export class JsonRpc<Out extends { readonly ref: number }, In extends RpcReply> {
  private readonly pending = new Map<number, Pending<In>>();
  private nextRef = 1;

  constructor(
    private readonly send: (message: Out) => void,
    private readonly timeoutMs = 10_000,
  ) {}

  call(expect: In['t'], build: (ref: number) => Out): Promise<In> {
    const ref = this.nextRef++;
    return new Promise<In>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(ref);
        reject(new ChallengeConnectionError('the server did not answer in time'));
      }, this.timeoutMs);
      this.pending.set(ref, { expect, resolve, reject, timer });
      try {
        this.send(build(ref));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(ref);
        reject(new ChallengeConnectionError(err instanceof Error ? err.message : 'send failed'));
      }
    });
  }

  /** Feeds a server message in; true when it answered a pending request. */
  handle(message: In, errorType = 'challenge_error', errorText?: (m: In) => string): boolean {
    if (message.ref === null) return false;
    const pending = this.pending.get(message.ref);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(message.ref);
    if (message.t === errorType)
      pending.reject(new ChallengeProtocolError(errorText ? errorText(message) : 'server error'));
    else if (message.t !== pending.expect)
      pending.reject(new ChallengeProtocolError(`unexpected reply ${message.t}`));
    else pending.resolve(message);
    return true;
  }

  failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
