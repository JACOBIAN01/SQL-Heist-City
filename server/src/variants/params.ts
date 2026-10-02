import type { ParamSpec, Rng } from '@heist/shared';
import type { DatasetRegistry } from './datasets';
import { pickSource, randomDate, randomStepInt } from './values';

export type ParamValue = string | number | boolean;
export type ResolvedParams = Readonly<Record<string, ParamValue>>;

type ResolverFor<K extends ParamSpec['kind']> = (
  spec: Extract<ParamSpec, { kind: K }>,
  rng: Rng,
  datasets: DatasetRegistry,
) => ParamValue;

// Pattern: Strategy (lookup table) — Why: one small resolver per param kind.
// The mapped type forces a resolver for every kind in the shared schema, so
// adding a kind there is a compile error here until it is handled.
const resolvers: { [K in ParamSpec['kind']]: ResolverFor<K> } = {
  pick: (spec, rng, datasets) => rng.pick(pickSource(spec.from, datasets)),
  int: (spec, rng) => randomStepInt(rng, spec.min, spec.max, spec.step),
  date: (spec, rng) => randomDate(rng, spec.from, spec.to),
  bool: (spec, rng) => rng.bool(spec.p),
};

/**
 * Resolves every param of a question for one seed. Each param draws from its
 * own forked stream, so adding or reordering params doesn't change the others.
 */
export function resolveParams(
  specs: Readonly<Record<string, ParamSpec>>,
  rng: Rng,
  datasets: DatasetRegistry,
): ResolvedParams {
  const out: Record<string, ParamValue> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const resolve = resolvers[spec.kind] as ResolverFor<typeof spec.kind>;
    out[name] = resolve(spec as never, rng.fork(`param:${name}`), datasets);
  }
  return out;
}
