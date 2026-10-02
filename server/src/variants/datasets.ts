/**
 * Named value lists question authors can reference instead of inlining
 * arrays, e.g. `{ "kind": "pick", "from": "first_names" }`.
 * Phase 3.2 expands these for the 150 seed questions.
 */
export type DatasetValue = string | number;

export interface DatasetRegistry {
  get(name: string): readonly DatasetValue[] | undefined;
  names(): string[];
}

export class UnknownDatasetError extends Error {
  constructor(readonly dataset: string) {
    super(`unknown dataset "${dataset}"`);
    this.name = 'UnknownDatasetError';
  }
}

export class MapDatasetRegistry implements DatasetRegistry {
  private readonly data: ReadonlyMap<string, readonly DatasetValue[]>;

  constructor(data: Record<string, readonly DatasetValue[]>) {
    this.data = new Map(Object.entries(data));
  }

  get(name: string): readonly DatasetValue[] | undefined {
    return this.data.get(name);
  }

  names(): string[] {
    return [...this.data.keys()].sort();
  }
}

export const builtInDatasets = new MapDatasetRegistry({
  first_names: [
    'Aarav',
    'Aisha',
    'Ben',
    'Chen',
    'Diego',
    'Elena',
    'Farah',
    'Gabriel',
    'Hana',
    'Ivan',
    'Jaya',
    'Kofi',
    'Lena',
    'Mateo',
    'Nadia',
    'Omar',
    'Priya',
    'Quinn',
    'Rosa',
    'Sami',
    'Tara',
    'Umar',
    'Vera',
    'Wei',
    'Yara',
    'Zane',
  ],
  last_names: [
    'Adeyemi',
    'Brown',
    'Costa',
    'Das',
    'Evans',
    'Fischer',
    'Garcia',
    'Hughes',
    'Ito',
    'Jones',
    'Khan',
    'Lopez',
    'Mehta',
    'Novak',
    'Okafor',
    'Patel',
    'Rossi',
    'Silva',
    'Tanaka',
    'Wong',
  ],
  cities: ['Harbor City', 'Northgate', 'Eastvale', 'Riverside', 'Old Town', 'Westport'],
  departments: ['Teller', 'Security', 'Audit', 'IT', 'Loans', 'Vault Ops'],
});
