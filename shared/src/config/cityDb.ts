import { z } from 'zod';

/**
 * The city database (Phase 33): live tables that mirror the world — guards, cameras, cash lying about,
 * wanted players, police, banks and vault doors. A student gets intel by *writing a query* over them
 * and, from the higher tiers, hacks cameras and doors by writing an UPDATE. Defaults only: every
 * request, its tier, its words and its reference answer are data (admin → Settings → City database).
 */

/** One table of the city database as the client shows it. */
export interface CityTable {
  readonly name: string;
  readonly about: string;
  readonly columns: readonly {
    readonly name: string;
    readonly type: string;
    readonly about: string;
  }[];
}

export const CITY_TABLES: readonly CityTable[] = [
  {
    name: 'guards',
    about: 'Armed staff of the banks.',
    columns: [
      { name: 'id', type: 'INTEGER', about: 'the guard' },
      { name: 'bank', type: 'TEXT', about: 'the bank they work at, such as bank-3' },
      { name: 'x', type: 'REAL', about: 'east–west position (m)' },
      { name: 'z', type: 'REAL', about: 'north–south position (m)' },
      { name: 'storey', type: 'INTEGER', about: 'floor they are on (0 is the street)' },
      { name: 'alert', type: 'INTEGER', about: '1 while an alarm is ringing' },
    ],
  },
  {
    name: 'cameras',
    about: 'Security cameras in and outside the banks.',
    columns: [
      { name: 'id', type: 'TEXT', about: 'the camera, such as bank-3:cam-2' },
      { name: 'bank', type: 'TEXT', about: 'the bank it watches' },
      { name: 'x', type: 'REAL', about: 'east–west position (m)' },
      { name: 'z', type: 'REAL', about: 'north–south position (m)' },
      { name: 'enabled', type: 'INTEGER', about: '1 while it is watching' },
    ],
  },
  {
    name: 'cash_drops',
    about: 'Cash lying in the city.',
    columns: [
      { name: 'id', type: 'INTEGER', about: 'the bag' },
      { name: 'x', type: 'REAL', about: 'east–west position (m)' },
      { name: 'z', type: 'REAL', about: 'north–south position (m)' },
      { name: 'amount', type: 'INTEGER', about: 'dollars in it' },
      { name: 'loose', type: 'INTEGER', about: '1 for loose office cash' },
    ],
  },
  {
    name: 'wanted',
    about: 'Players carrying enough cash to have a bounty on them.',
    columns: [
      { name: 'id', type: 'INTEGER', about: 'the player' },
      { name: 'name', type: 'TEXT', about: 'their name' },
      { name: 'cash', type: 'INTEGER', about: 'dollars they carry' },
      { name: 'x', type: 'REAL', about: 'east–west position (m)' },
      { name: 'z', type: 'REAL', about: 'north–south position (m)' },
    ],
  },
  {
    name: 'police',
    about: 'Officers on the street.',
    columns: [
      { name: 'id', type: 'INTEGER', about: 'the officer' },
      { name: 'target', type: 'INTEGER', about: 'the wanted player they are after (wanted.id)' },
      { name: 'x', type: 'REAL', about: 'east–west position (m)' },
      { name: 'z', type: 'REAL', about: 'north–south position (m)' },
      { name: 'role', type: 'TEXT', about: "'chase' or 'roadblock'" },
    ],
  },
  {
    name: 'banks',
    about: 'The five banks.',
    columns: [
      { name: 'id', type: 'TEXT', about: 'bank-1 to bank-5' },
      { name: 'name', type: 'TEXT', about: 'its name' },
      { name: 'tier', type: 'INTEGER', about: '1 (outskirts) to 5 (centre)' },
      { name: 'locks', type: 'INTEGER', about: 'locks on its vault' },
      { name: 'opened', type: 'INTEGER', about: 'locks cracked so far' },
      { name: 'x', type: 'REAL', about: 'east–west position (m)' },
      { name: 'z', type: 'REAL', about: 'north–south position (m)' },
    ],
  },
  {
    name: 'doors',
    about: 'The vault doors, and whether their controller has them locked.',
    columns: [
      { name: 'id', type: 'TEXT', about: 'the door' },
      { name: 'bank', type: 'TEXT', about: 'the bank it belongs to' },
      { name: 'locked', type: 'INTEGER', about: '1 while locked' },
    ],
  },
];

/** The schema the sandbox is built from. */
export const CITY_SCHEMA_SQL = [
  'CREATE TABLE guards (id INTEGER PRIMARY KEY, bank TEXT, x REAL, z REAL, storey INTEGER, alert INTEGER)',
  'CREATE TABLE cameras (id TEXT PRIMARY KEY, bank TEXT, x REAL, z REAL, enabled INTEGER)',
  'CREATE TABLE cash_drops (id INTEGER PRIMARY KEY, x REAL, z REAL, amount INTEGER, loose INTEGER)',
  'CREATE TABLE wanted (id INTEGER PRIMARY KEY, name TEXT, cash INTEGER, x REAL, z REAL)',
  'CREATE TABLE police (id INTEGER PRIMARY KEY, target INTEGER, x REAL, z REAL, role TEXT)',
  'CREATE TABLE banks (id TEXT PRIMARY KEY, name TEXT, tier INTEGER, locks INTEGER, opened INTEGER, x REAL, z REAL)',
  'CREATE TABLE doors (id TEXT PRIMARY KEY, bank TEXT, locked INTEGER)',
].join(';\n');

export const CITY_REQUEST_KINDS = ['intel', 'camera', 'door'] as const;
export type CityRequestKind = (typeof CITY_REQUEST_KINDS)[number];

const requestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.enum(CITY_REQUEST_KINDS),
  /** 1–5: how hard, and so how good the intel is. */
  tier: z.number().int().min(1).max(5),
  title: z.string().min(1).max(80),
  /** What the student is asked to find or do, in plain words. */
  prompt: z.string().min(1).max(400),
  /** Which tables it is about (shown to the student). */
  tables: z.array(z.string()).min(1),
  /** The bank a camera or door request is about. */
  bank: z
    .string()
    .regex(/^bank-[1-5]$/)
    .optional(),
  /** The answer. Never sent to a client: the server runs it on the same snapshot and compares. */
  reference: z.string().min(1).max(2000),
});
export type CityRequest = z.infer<typeof requestSchema>;

/** What a client is told about a request: everything but the answer. */
export type PublicCityRequest = Omit<CityRequest, 'reference'>;

export function publicRequests(requests: readonly CityRequest[]): PublicCityRequest[] {
  return requests.map(({ reference: _answer, ...rest }) => rest);
}

const BANK_NAMES: Record<string, string> = {
  'bank-1': 'Corner Savings',
  'bank-2': 'City Trust',
  'bank-3': 'Metro Capital',
  'bank-4': 'Grand Reserve',
  'bank-5': 'Federal Vault',
};

function defaultRequests(): CityRequest[] {
  const out: CityRequest[] = [
    {
      id: 'guards-all',
      kind: 'intel',
      tier: 1,
      title: 'Every guard',
      prompt: 'Show where every guard is. Return their x and z.',
      tables: ['guards'],
      reference: 'SELECT x, z FROM guards',
    },
    {
      id: 'cash-all',
      kind: 'intel',
      tier: 1,
      title: 'Cash on the ground',
      prompt: 'Show every bag of cash lying in the city. Return x and z.',
      tables: ['cash_drops'],
      reference: 'SELECT x, z FROM cash_drops',
    },
    {
      id: 'cash-big',
      kind: 'intel',
      tier: 2,
      title: 'The big bags',
      prompt: 'Show only the bags with more than $5,000 in them. Return x, z and amount.',
      tables: ['cash_drops'],
      reference: 'SELECT x, z, amount FROM cash_drops WHERE amount > 5000',
    },
    {
      id: 'guards-alert',
      kind: 'intel',
      tier: 2,
      title: 'Guards on alert',
      prompt: 'Show the guards whose alarm is ringing. Return x and z.',
      tables: ['guards'],
      reference: 'SELECT x, z FROM guards WHERE alert = 1',
    },
    {
      id: 'wanted-named',
      kind: 'intel',
      tier: 3,
      title: 'The richest runner',
      prompt: 'Show the wanted player carrying the most cash. Return name, x and z.',
      tables: ['wanted'],
      reference: 'SELECT name, x, z FROM wanted ORDER BY cash DESC LIMIT 1',
    },
    {
      id: 'police-chasing',
      kind: 'intel',
      tier: 3,
      title: 'Who the police are after',
      prompt:
        'Show the officers who are chasing someone, with the name of the player they are after. Return x, z and name.',
      tables: ['police', 'wanted'],
      reference:
        "SELECT p.x, p.z, w.name FROM police p JOIN wanted w ON w.id = p.target WHERE p.role = 'chase'",
    },
    {
      id: 'weakest-bank',
      kind: 'intel',
      tier: 4,
      title: 'The bank with the fewest guards',
      prompt: 'Show the bank with the fewest guards. Return x, z and name.',
      tables: ['banks', 'guards'],
      reference:
        'SELECT b.x, b.z, b.name FROM banks b LEFT JOIN guards g ON g.bank = b.id GROUP BY b.id ORDER BY COUNT(g.id) ASC, b.id LIMIT 1',
    },
  ];
  for (const n of [1, 2, 3, 4, 5]) {
    const bank = `bank-${n}`;
    const name = BANK_NAMES[bank] ?? bank;
    out.push(
      {
        id: `guards-${bank}`,
        kind: 'intel',
        tier: Math.min(5, n + 1),
        title: `The guards of ${name}`,
        prompt: `Show the guards of ${name} (${bank}) only. Return x and z.`,
        tables: ['guards'],
        reference: `SELECT x, z FROM guards WHERE bank = '${bank}'`,
      },
      {
        id: `cameras-${bank}`,
        kind: 'camera',
        tier: Math.min(5, n + 1),
        title: `Switch off the cameras at ${name}`,
        prompt: `Switch off the cameras of ${name} (${bank}) and no others, by setting enabled to 0.`,
        tables: ['cameras'],
        bank,
        reference: `UPDATE cameras SET enabled = 0 WHERE bank = '${bank}'`,
      },
      {
        id: `door-${bank}`,
        kind: 'door',
        tier: 5,
        title: `Unlock the vault door at ${name}`,
        prompt: `Unlock the vault door of ${name} (${bank}) and no other, by setting locked to 0.`,
        tables: ['doors'],
        bank,
        reference: `UPDATE doors SET locked = 0 WHERE bank = '${bank}'`,
      },
    );
  }
  return out;
}

export const cityDbSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  requests: z.array(requestSchema).default(defaultRequests),
  /** How long (s) intel stays on the map, by the request's tier "1"–"5": better queries, longer intel. */
  intelSeconds: z
    .record(z.string(), z.number().positive())
    .default({ '1': 20, '2': 30, '3': 45, '4': 60, '5': 90 }),
  /** Intel shows only what is within this many metres of you when you ask (a query is not a satellite). */
  rangeMeters: z.number().positive().default(140),
  /** The most pins one player's intel can hold at once. */
  maxPins: z.number().int().positive().default(30),
  /** Seconds before the same player may ask the same request again, by kind. */
  cooldownSeconds: z
    .object({
      intel: z.number().min(0).default(15),
      camera: z.number().min(0).default(90),
      door: z.number().min(0).default(150),
    })
    .default({ intel: 15, camera: 90, door: 150 }),
  /** Seconds a bank's guards stay blind after its cameras are switched off. */
  cameraSeconds: z.number().positive().default(45),
  /** The hardest tier of request a student may try, by their progress would go here; 5 for now. */
  maxTier: z.number().int().min(1).max(5).default(5),
});
export type CityDbSettings = z.infer<typeof cityDbSettingsSchema>;
export const DEFAULT_CITY_DB_SETTINGS: CityDbSettings = cityDbSettingsSchema.parse({});

/** How long intel from a request of this tier stays on the map (s). */
export function intelSecondsFor(tier: number, settings: CityDbSettings): number {
  return settings.intelSeconds[String(tier)] ?? 20;
}
