import type { Rng } from '@heist/shared';
import { UnknownDatasetError, type DatasetRegistry, type DatasetValue } from './datasets';

const DAY_MS = 86_400_000;

/** Uniform date in [from, to] (YYYY-MM-DD, inclusive), returned as YYYY-MM-DD. */
export function randomDate(rng: Rng, from: string, to: string): string {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    throw new RangeError(`invalid date range ${from}..${to}`);
  }
  const days = rng.int(0, Math.round((end - start) / DAY_MS));
  return new Date(start + days * DAY_MS).toISOString().slice(0, 10);
}

/** Integer in [min, max] on a step grid anchored at min. */
export function randomStepInt(rng: Rng, min: number, max: number, step: number): number {
  return min + rng.int(0, Math.floor((max - min) / step)) * step;
}

/** Resolves `from` (inline list or dataset name) to concrete values. */
export function pickSource(
  from: readonly DatasetValue[] | string,
  datasets: DatasetRegistry,
): readonly DatasetValue[] {
  if (typeof from !== 'string') return from;
  const values = datasets.get(from);
  if (!values || values.length === 0) throw new UnknownDatasetError(from);
  return values;
}
