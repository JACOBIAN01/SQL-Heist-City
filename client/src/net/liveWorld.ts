import {
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  VEHICLE_KINDS,
  type AtmosphereSettings,
  type VehicleSettings,
  type WorldMessage,
} from '@heist/shared';

/**
 * The car and sky numbers in force, as the server last said. They start as the
 * defaults and are rewritten in place when a `world` message arrives, so the
 * car drawing, prediction and sky code that hold these objects follow the
 * server's numbers without being rebuilt.
 */
export class LiveWorld {
  readonly vehicles: VehicleSettings = structuredClone(DEFAULT_VEHICLE_SETTINGS);
  readonly atmosphere: AtmosphereSettings = { ...DEFAULT_ATMOSPHERE_SETTINGS };

  apply(message: Pick<WorldMessage, 'vehicles' | 'atmosphere'>): void {
    const { kinds, ...rest } = message.vehicles;
    Object.assign(this.vehicles, rest);
    for (const kind of VEHICLE_KINDS) Object.assign(this.vehicles.kinds[kind], kinds[kind]);
    Object.assign(this.atmosphere, message.atmosphere);
  }
}
