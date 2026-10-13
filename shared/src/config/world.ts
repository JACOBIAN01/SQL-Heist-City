import type { AtmosphereSettings } from './atmosphere';
import type { HeistSettings } from './heist';
import type { VehicleSettings } from './vehicles';

/**
 * The settings a running match re-reads at the start of every round, so an
 * admin edit lands without a restart. `vehicles` and `atmosphere` are also
 * sent to every client, which must simulate and draw with the same numbers.
 */
export interface WorldSettings {
  readonly heist: HeistSettings;
  readonly vehicles: VehicleSettings;
  readonly atmosphere: AtmosphereSettings;
}
