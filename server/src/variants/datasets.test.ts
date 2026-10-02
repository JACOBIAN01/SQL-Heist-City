import { describe, expect, it } from 'vitest';
import { builtInDatasets } from './datasets';

describe('builtInDatasets', () => {
  it.each(builtInDatasets.names())('%s is non-empty and has no duplicates', (name) => {
    const values = builtInDatasets.get(name) ?? [];
    expect(values.length).toBeGreaterThan(2);
    expect(new Set(values).size).toBe(values.length);
  });
});
