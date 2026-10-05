import {
  nearestAnchor,
  type GameMap,
  type InteractResult,
  type JsonClientMessage,
  type JsonServerMessage,
  type MapAnchor,
} from '@heist/shared';
import { JsonRpc } from '../net/JsonRpc';

/** The words on the prompt for each kind of anchor. */
export function promptText(anchor: MapAnchor): string {
  switch (anchor.kind) {
    case 'elevator':
      return 'Take the lift';
    case 'vault_console':
      return 'Crack the vault lock';
    case 'safehouse':
      return 'Bank your cash';
  }
}

export const DENIAL_TEXT: Readonly<Record<string, string>> = {
  unknown_anchor: 'Nothing here',
  too_far: 'Too far away',
  dead: 'You are dead',
  cooldown: 'Slow down',
  nothing_to_bank: 'You are not carrying any cash',
  not_available: 'Not available right now',
};

export interface InteractionsView {
  /** Shows "F — text" (or hides it with undefined). */
  setPrompt(text: string | undefined): void;
  toast(text: string): void;
}

export interface InteractionsDeps {
  readonly map: GameMap;
  readonly send: (message: JsonClientMessage) => void;
  readonly view: InteractionsView;
  /** The server says this use starts a SQL task. */
  readonly onOpenTask: (rewardKey: string, target: string) => void;
}

/**
 * Press F near something usable. The client only decides *what to offer*
 * (the nearest anchor in reach); the server decides whether the use works.
 */
export class Interactions {
  private readonly rpc: JsonRpc<
    Extract<JsonClientMessage, { t: 'interact' }>,
    Extract<JsonServerMessage, { t: 'interact_result' }>
  >;
  private current: MapAnchor | undefined;
  private busy = false;

  constructor(private readonly deps: InteractionsDeps) {
    this.rpc = new JsonRpc((m) => deps.send(m), 5_000);
  }

  /** True while an anchor is offered (other F actions, such as cars, then wait). */
  get hasTarget(): boolean {
    return this.current !== undefined;
  }

  /** Call each frame (or tick) with the local player's position and whether they can act. */
  update(x: number, y: number, z: number, enabled: boolean): void {
    const anchor = enabled ? nearestAnchor(this.deps.map, x, y, z) : undefined;
    if (anchor?.id === this.current?.id) return;
    this.current = anchor;
    this.deps.view.setPrompt(anchor ? `F — ${promptText(anchor)}` : undefined);
  }

  /** The player pressed F. */
  async use(): Promise<void> {
    const anchor = this.current;
    if (!anchor || this.busy) return;
    this.busy = true;
    try {
      const reply = await this.rpc.call('interact_result', (ref) => ({
        t: 'interact',
        ref,
        anchor: anchor.id,
      }));
      this.apply(reply.result);
    } catch {
      this.deps.view.toast('No answer from the server');
    } finally {
      this.busy = false;
    }
  }

  /** Feed JSON messages from the server; true if it was an interaction reply. */
  handle(message: JsonServerMessage): boolean {
    if (message.t !== 'interact_result') return false;
    this.rpc.handle(message);
    return true;
  }

  private apply(result: InteractResult): void {
    switch (result.action) {
      case 'moved':
        this.deps.view.toast(result.storey === 0 ? 'Ground floor' : `Floor ${result.storey}`);
        break;
      case 'banking':
        break; // the progress bar is driven by the server's banking messages
      case 'open_task':
        this.deps.onOpenTask(result.rewardKey, result.target);
        break;
      case 'denied':
        this.deps.view.toast(DENIAL_TEXT[result.reason] ?? 'Cannot do that');
        break;
    }
  }
}
