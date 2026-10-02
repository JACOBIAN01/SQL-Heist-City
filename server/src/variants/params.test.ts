import { describe, expect, it } from 'vitest';
import { SeededRng, paramSpecSchema, type ParamSpec } from '@heist/shared';
import { MapDatasetRegistry, UnknownDatasetError, builtInDatasets } from './datasets';
import { resolveParams } from './params';
import { randomDate, randomStepInt } from './values';

const specs = (raw: Record<string, unknown>): Record<string, ParamSpec> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, paramSpecSchema.parse(v)]));

const sample = specs({
  dept: { kind: 'pick', from: ['Teller', 'Security', 'Audit', 'IT'] },
  min_salary: { kind: 'int', min: 3000, max: 6000, step: 500 },
  since: { kind: 'date', from: '2024-01-01', to: '2024-12-31' },
  vip: { kind: 'bool', p: 0.5 },
  first: { kind: 'pick', from: 'first_names' },
});

describe('resolveParams', () => {
  it('is deterministic per seed', () => {
    const a = resolveParams(sample, new SeededRng('s1'), builtInDatasets);
    const b = resolveParams(sample, new SeededRng('s1'), builtInDatasets);
    expect(a).toEqual(b);
  });

  it('produces different values across seeds', () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) =>
        JSON.stringify(resolveParams(sample, new SeededRng(`seed-${i}`), builtInDatasets)),
      ),
    );
    expect(seen.size).toBeGreaterThan(15);
  });

  it('respects each spec', () => {
    for (let i = 0; i < 200; i++) {
      const p = resolveParams(sample, new SeededRng(`r${i}`), builtInDatasets);
      expect(['Teller', 'Security', 'Audit', 'IT']).toContain(p.dept);
      expect([3000, 3500, 4000, 4500, 5000, 5500, 6000]).toContain(p.min_salary);
      expect(p.since).toMatch(/^2024-\d{2}-\d{2}$/);
      expect(typeof p.vip).toBe('boolean');
      expect(builtInDatasets.get('first_names')).toContain(p.first);
    }
  });

  it('keeps a param stable when another param is added', () => {
    const before = resolveParams(
      specs({ a: { kind: 'int', min: 0, max: 1e6 } }),
      new SeededRng('x'),
      builtInDatasets,
    );
    const after = resolveParams(
      specs({ z: { kind: 'int', min: 0, max: 1e6 }, a: { kind: 'int', min: 0, max: 1e6 } }),
      new SeededRng('x'),
      builtInDatasets,
    );
    expect(after.a).toBe(before.a);
  });

  it('fails clearly on an unknown dataset', () => {
    expect(() =>
      resolveParams(
        specs({ x: { kind: 'pick', from: 'nope' } }),
        new SeededRng('x'),
        new MapDatasetRegistry({}),
      ),
    ).toThrow(UnknownDatasetError);
  });
});

describe('value helpers', () => {
  it('randomDate stays within an inclusive range', () => {
    const rng = new SeededRng('d');
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(randomDate(rng, '2024-02-28', '2024-03-01'));
    expect([...seen].sort()).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('randomStepInt never exceeds max even when the range is not a step multiple', () => {
    const rng = new SeededRng('s');
    for (let i = 0; i < 500; i++) expect(randomStepInt(rng, 0, 10, 4)).toBeLessThanOrEqual(8);
  });
});
