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

/**
 * Shared value lists for the seed questions, themed on the heist city.
 * Lists are long enough that random picks rarely collide.
 */
export const builtInDatasets = new MapDatasetRegistry({
  first_names: [
    'Aarav',
    'Aisha',
    'Amara',
    'Ben',
    'Bianca',
    'Chen',
    'Chloe',
    'Dario',
    'Diego',
    'Elena',
    'Emeka',
    'Farah',
    'Felix',
    'Gabriel',
    'Gwen',
    'Hana',
    'Hugo',
    'Ines',
    'Ivan',
    'Jaya',
    'Jonas',
    'Kai',
    'Kofi',
    'Lars',
    'Lena',
    'Leila',
    'Mateo',
    'Maya',
    'Nadia',
    'Nico',
    'Omar',
    'Olga',
    'Priya',
    'Pablo',
    'Quinn',
    'Rosa',
    'Rahul',
    'Sami',
    'Sofia',
    'Tara',
    'Theo',
    'Umar',
    'Uma',
    'Vera',
    'Viktor',
    'Wei',
    'Willa',
    'Yara',
    'Yusuf',
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
    'Yilmaz',
    'Zhou',
    'Moreau',
    'Kowalski',
    'Nguyen',
    'Haddad',
    'Larsen',
    'Petrov',
    'Reyes',
    'Sato',
  ],
  cities: [
    'Harbor City',
    'Northgate',
    'Eastvale',
    'Riverside',
    'Old Town',
    'Westport',
    'Hillcrest',
    'Southbay',
  ],
  departments: ['Teller', 'Security', 'Audit', 'IT', 'Loans', 'Vault Ops'],
  branch_names: [
    'Corner Savings',
    'City Trust',
    'Metro Capital',
    'Grand Reserve',
    'Federal Vault',
    'Harbor Credit',
    'Union Mutual',
    'Summit Bank',
  ],
  account_types: ['checking', 'savings', 'business', 'student', 'premium'],
  account_statuses: ['active', 'frozen', 'closed'],
  transaction_kinds: ['deposit', 'withdrawal', 'transfer', 'fee', 'interest'],
  merchants: [
    'Quick Mart',
    'Neon Diner',
    'Fuel Stop',
    'Gadget Hub',
    'Book Nook',
    'Pizza Planet',
    'Taxi Co',
    'Cinema 9',
    'Gym Plus',
    'Coffee Lab',
    'Pharma One',
    'Shoe Box',
  ],
  vault_zones: [
    'Lobby',
    'Office',
    'Server Room',
    'Vault A',
    'Vault B',
    'Roof',
    'Garage',
    'Basement',
  ],
  vault_actions: ['open', 'close', 'inspect', 'deposit', 'withdraw'],
  alarm_levels: ['low', 'medium', 'high', 'critical'],
  shift_names: ['morning', 'day', 'evening', 'night'],
  item_types: [
    'gold bar',
    'diamond',
    'bond',
    'cash bundle',
    'painting',
    'watch',
    'necklace',
    'coin set',
  ],
  camera_statuses: ['online', 'offline', 'maintenance'],
  loan_statuses: ['pending', 'approved', 'rejected', 'repaid'],
  crew_roles: ['driver', 'hacker', 'lookout', 'safecracker', 'muscle'],
  streets: [
    'Main St',
    'Harbor Rd',
    'Elm Ave',
    'King St',
    'Mill Ln',
    'Park Blvd',
    'Bridge St',
    'Station Rd',
    'Lake Dr',
    'Hill St',
  ],
});
