import type {
  JsonClientMessage,
  JsonServerMessage,
  VehicleDenial,
  VehicleReply,
} from '@heist/shared';
import { JsonRpc } from '../net/JsonRpc';
import type { RemoteVehicles } from './RemoteVehicles';

const DENIAL_TEXT: Readonly<Record<VehicleDenial, string>> = {
  unknown_vehicle: 'That car is gone',
  too_far: 'Get closer to the car',
  taken: 'Someone is already driving it',
  dead: 'Not while you are down',
  already_driving: 'You are already driving',
  not_driving: 'You are not in a car',
  too_fast: 'Slow down to get out',
  no_room: 'No room to get out here',
};

export interface VehicleControlsView {
  setPrompt(text: string | undefined): void;
  toast(text: string): void;
}

export interface VehicleControlsDeps {
  readonly send: (message: JsonClientMessage) => void;
  readonly view: VehicleControlsView;
  readonly vehicles: RemoteVehicles;
}

/**
 * F near an empty car gets in; F at the wheel gets out. The client offers,
 * the server decides (range, speed, room to step out).
 */
export class VehicleControls {
  private readonly rpc: JsonRpc<Extract<JsonClientMessage, { t: 'vehicle' }>, VehicleReply>;
  private target: number | undefined;
  private driving = false;
  private shown: string | undefined;
  private busy = false;

  constructor(private readonly deps: VehicleControlsDeps) {
    this.rpc = new JsonRpc((m) => deps.send(m), 5_000);
  }

  /**
   * Call each frame. `blocked` while something else owns the prompt (a bank
   * anchor in reach); the car prompt then waits and comes back afterwards.
   */
  update(x: number, z: number, driving: boolean, enabled: boolean, blocked: boolean): void {
    this.driving = driving;
    this.target = enabled && !driving ? this.deps.vehicles.freeCarNear(x, z)?.id : undefined;
    if (blocked && !driving) {
      this.shown = undefined;
      return;
    }
    const text = !enabled
      ? undefined
      : driving
        ? 'F — get out'
        : this.target !== undefined
          ? 'F — get in'
          : undefined;
    if (text === this.shown) return;
    // Only clear a prompt we put up ourselves.
    if (text !== undefined || this.shown !== undefined) this.deps.view.setPrompt(text);
    this.shown = text;
  }

  /** Whether F has something to do for a car right now. */
  get available(): boolean {
    return this.driving || this.target !== undefined;
  }

  /** The player pressed F. */
  async use(): Promise<void> {
    if (this.busy || !this.available) return;
    const vehicle = this.target;
    const exiting = this.driving;
    this.busy = true;
    try {
      const reply = await this.rpc.call('vehicle_result', (ref) =>
        exiting
          ? { t: 'vehicle', ref, action: 'exit' }
          : { t: 'vehicle', ref, action: 'enter', vehicle: vehicle ?? 0 },
      );
      if (!reply.ok) this.deps.view.toast(DENIAL_TEXT[reply.reason ?? 'unknown_vehicle']);
    } catch {
      this.deps.view.toast('No answer from the server');
    } finally {
      this.busy = false;
    }
  }

  /** Feed JSON from the server; true if it was a car reply. */
  handle(message: JsonServerMessage): boolean {
    if (message.t !== 'vehicle_result') return false;
    this.rpc.handle(message);
    return true;
  }
}
