import type { MatchApi } from './MatchApi';

export interface Camera {
  readonly id: string;
  readonly bank: string;
  readonly x: number;
  readonly z: number;
}

/**
 * The banks' security cameras (Phase 33): three to a bank, one watching the vault console, one the
 * way to it and one the street entrance. They are placed from the map, so every server and every
 * match has the same ones, and a switched-off camera comes back on its own after a while.
 */
export class CameraGrid {
  readonly cameras: Camera[];
  /** Tick until which each bank's cameras are off. */
  private readonly offUntil = new Map<string, number>();

  constructor(private readonly match: MatchApi) {
    const map = match.map;
    const anchors = map.anchors ?? [];
    this.cameras = (map.vaults ?? []).flatMap((v): Camera[] => {
      const console_ = anchors.find((a) => a.id === v.consoleId);
      const door = anchors.find((a) => a.kind === 'intel_terminal' && a.bank === v.bank);
      if (!console_) return [];
      const out: Camera[] = [
        { id: `${v.bank}:cam-1`, bank: v.bank, x: console_.x, z: console_.z },
        { id: `${v.bank}:cam-2`, bank: v.bank, x: console_.x + 6, z: console_.z },
      ];
      if (door) out.push({ id: `${v.bank}:cam-3`, bank: v.bank, x: door.x, z: door.z });
      return out;
    });
  }

  /** Whether a bank's cameras are working now. */
  isOn(bank: string): boolean {
    return this.match.tick >= (this.offUntil.get(bank) ?? 0);
  }

  /** Switches a bank's cameras off for `seconds`. */
  switchOff(bank: string, seconds: number): void {
    this.offUntil.set(bank, this.match.tick + Math.round(seconds * this.match.tickRate));
  }

  /** A new round: every camera is on again. */
  reset(): void {
    this.offUntil.clear();
  }

  /** The cameras as the city database lists them. */
  list(): { id: string; bank: string; x: number; z: number; enabled: boolean }[] {
    return this.cameras.map((c) => ({ ...c, enabled: this.isOn(c.bank) }));
  }
}
