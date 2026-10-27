import { z } from 'zod';
import { JOB_KINDS } from './heist';

/**
 * The story (Phase 32): a crew, a fixer at each bank, and an arc across the five tiers. All of it is
 * data, so a teacher or the owner can rewrite the words without touching code. The bible is in
 * docs/story.md.
 */

/** What a step of a chain asks for. */
export const storyNeedSchema = z.discriminatedUnion('type', [
  /** Gather this much intel on the chain's bank (the terminal outside). */
  z.object({ type: z.literal('intel'), level: z.number().int().min(1).max(3) }),
  /** Finish a contract (of one kind, or any). */
  z.object({ type: z.literal('job'), kind: z.enum(JOB_KINDS).optional() }),
  /** Crack the bank's vault and bank the take. */
  z.object({ type: z.literal('heist') }),
]);
export type StoryNeed = z.infer<typeof storyNeedSchema>;

const lineSchema = z.object({
  speaker: z.string().min(1).max(40),
  text: z.string().min(1).max(280),
});
export type StoryLine = z.infer<typeof lineSchema>;

const stepSchema = z.object({
  id: z.string().min(1).max(32),
  title: z.string().min(1).max(60),
  /** What the fixer tells you to do. */
  text: z.string().min(1).max(280),
  need: storyNeedSchema,
});

const chainSchema = z.object({
  /** The bank this chain is about (`bank-1`…`bank-5`). */
  bank: z.string().regex(/^bank-[1-5]$/),
  name: z.string().min(1).max(60),
  fixer: z.object({ name: z.string().min(1).max(40), role: z.string().min(1).max(60) }),
  steps: z.array(stepSchema).min(1).max(6),
  /** The ledger page this chain gives you (a line of the evidence). */
  page: z.string().min(1).max(200),
  /** Paid when the chain is finished. */
  reward: z.object({ cash: z.number().int().min(0), xp: z.number().int().min(0) }),
  /** Scenes played when it starts and when it ends. */
  intro: z.string().min(1),
  outro: z.string().min(1),
});
export type StoryChain = z.infer<typeof chainSchema>;

const sceneSchema = z.object({
  title: z.string().min(1).max(60),
  lines: z.array(lineSchema).min(1).max(8),
});
export type StoryScene = z.infer<typeof sceneSchema>;

/** Moments a fixer comments on (Phase 32.3). */
export const BARK_EVENTS = [
  'intel',
  'lock',
  'vault',
  'getaway',
  'complete',
  'failed',
  'wanted',
  'job',
] as const;
export type BarkEvent = (typeof BARK_EVENTS)[number];

export const storySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  chains: z.array(chainSchema).default(() => DEFAULT_CHAINS),
  scenes: z.record(z.string(), sceneSchema).default(() => DEFAULT_SCENES),
  /** Short lines a fixer says at a moment, per bank (a missing bank falls back to `any`). */
  barks: z
    .record(z.string(), z.record(z.string(), z.array(z.string().min(1).max(160)).min(1)))
    .default(() => DEFAULT_BARKS),
  /** One line above every question on this reward family, to tie it to the story (Phase 32.4). */
  frames: z.record(z.string(), z.string().min(1).max(200)).default(() => DEFAULT_FRAMES),
});
export type StorySettings = z.infer<typeof storySettingsSchema>;

const HEIST = { type: 'heist' as const };

const DEFAULT_CHAINS: StoryChain[] = [
  {
    bank: 'bank-1',
    name: 'The first page',
    fixer: { name: 'Mae Okafor', role: 'former teller at Corner Savings' },
    steps: [
      {
        id: 'briefing',
        title: 'The briefing',
        text: 'Read the terminal outside Corner Savings. Mae has left a question to prove you can read a table.',
        need: { type: 'intel', level: 1 },
      },
      {
        id: 'favour',
        title: 'A small favour',
        text: 'Run a parcel across town for Mae. Nobody asks what is in it.',
        need: { type: 'job', kind: 'delivery' },
      },
      {
        id: 'heist',
        title: 'The vault',
        text: 'Open the vault at Corner Savings and bring the cash home.',
        need: HEIST,
      },
    ],
    page: 'Corner Savings logged deposits twice. The second set was never real.',
    reward: { cash: 2_000, xp: 60 },
    intro: 'mae-intro',
    outro: 'mae-outro',
  },
  {
    bank: 'bank-2',
    name: 'Two ledgers',
    fixer: { name: 'Dev Rao', role: 'auditor at City Trust' },
    steps: [
      {
        id: 'briefing',
        title: 'The briefing',
        text: 'Dev needs to know how City Trust files its accounts. Use the terminal outside.',
        need: { type: 'intel', level: 1 },
      },
      {
        id: 'favour',
        title: 'Look around',
        text: 'Visit other banks and note what you see. Dev calls it recon.',
        need: { type: 'job', kind: 'intel' },
      },
      {
        id: 'heist',
        title: 'The vault',
        text: 'Open the vault at City Trust. The second ledger is in there.',
        need: HEIST,
      },
    ],
    page: 'City Trust keeps two ledgers: one for the auditors, one for the truth.',
    reward: { cash: 3_000, xp: 80 },
    intro: 'dev-intro',
    outro: 'dev-outro',
  },
  {
    bank: 'bank-3',
    name: 'The numbers do not add up',
    fixer: { name: 'Inez Vega', role: 'analyst at Metro Capital' },
    steps: [
      {
        id: 'briefing',
        title: 'The briefing',
        text: 'Inez has a theory. Gather intel on Metro Capital before she tells you what it is.',
        need: { type: 'intel', level: 2 },
      },
      {
        id: 'favour',
        title: 'Blind the cameras',
        text: 'Cut the guards’ cameras at a bank so Inez can pull the logs.',
        need: { type: 'job', kind: 'sabotage' },
      },
      {
        id: 'heist',
        title: 'The vault',
        text: 'Open the vault at Metro Capital. Bank every dollar: it proves her totals.',
        need: HEIST,
      },
    ],
    page: 'Metro Capital’s totals are short by exactly what Grand Reserve is long.',
    reward: { cash: 4_500, xp: 100 },
    intro: 'inez-intro',
    outro: 'inez-outro',
  },
  {
    bank: 'bank-4',
    name: 'Walt’s old beat',
    fixer: { name: 'Walt Brennan', role: 'retired guard of Grand Reserve' },
    steps: [
      {
        id: 'briefing',
        title: 'The briefing',
        text: 'Walt knew every guard at Grand Reserve. Learn what he knew at the terminal.',
        need: { type: 'intel', level: 2 },
      },
      {
        id: 'favour',
        title: 'Walk him through',
        text: 'Walt’s nephew needs to cross the city safely. Escort him.',
        need: { type: 'job', kind: 'escort' },
      },
      {
        id: 'heist',
        title: 'The vault',
        text: 'Open the vault at Grand Reserve. The money in there is the money Metro lost.',
        need: HEIST,
      },
    ],
    page: 'Every night at three, Grand Reserve takes a delivery that is not on any manifest.',
    reward: { cash: 6_000, xp: 120 },
    intro: 'walt-intro',
    outro: 'walt-outro',
  },
  {
    bank: 'bank-5',
    name: 'The Reserve',
    fixer: { name: 'Lena Hart', role: 'the crew’s leader, once at Federal Vault' },
    steps: [
      {
        id: 'briefing',
        title: 'The briefing',
        text: 'Lena built the crew to end this. Learn everything about Federal Vault.',
        need: { type: 'intel', level: 3 },
      },
      {
        id: 'favour',
        title: 'Copy the records',
        text: 'Copy a bank’s records at its console. Lena needs the originals.',
        need: { type: 'job', kind: 'data_theft' },
      },
      {
        id: 'heist',
        title: 'The vault',
        text: 'Open the vault at Federal Vault. Marcus Vale’s books are inside.',
        need: HEIST,
      },
    ],
    page: 'Marcus Vale signed every false entry. His signature is on page one.',
    reward: { cash: 10_000, xp: 200 },
    intro: 'lena-intro',
    outro: 'lena-outro',
  },
];

const DEFAULT_SCENES: Record<string, StoryScene> = {
  'mae-intro': {
    title: 'Corner Savings',
    lines: [
      { speaker: 'Mae', text: 'You are the new hands? Good. I counted money here for nine years.' },
      {
        speaker: 'Mae',
        text: 'One day the deposits doubled on paper and nobody walked in. I asked why. I was let go.',
      },
      {
        speaker: 'Mae',
        text: 'Read the terminal outside. If you can read a table, I can use you.',
      },
    ],
  },
  'mae-outro': {
    title: 'The first page',
    lines: [
      {
        speaker: 'Mae',
        text: 'There. A deposit that never happened, with a real teller’s initials on it.',
      },
      {
        speaker: 'Mae',
        text: 'One page is a mistake. Five pages is a case. Dev is next, at City Trust.',
      },
    ],
  },
  'dev-intro': {
    title: 'City Trust',
    lines: [
      {
        speaker: 'Dev',
        text: 'Mae sent you. I audit City Trust. I audit what they show me, and I have started to wonder what they do not.',
      },
      { speaker: 'Dev', text: 'Learn how they file. Then we will see if the filing is honest.' },
    ],
  },
  'dev-outro': {
    title: 'Two ledgers',
    lines: [
      {
        speaker: 'Dev',
        text: 'Two ledgers, same accounts, different totals. That is not an error, it is a design.',
      },
      { speaker: 'Dev', text: 'Inez at Metro Capital will want to see this.' },
    ],
  },
  'inez-intro': {
    title: 'Metro Capital',
    lines: [
      {
        speaker: 'Inez',
        text: 'I do sums for a living, and this one will not close. Somewhere a bank is short.',
      },
      {
        speaker: 'Inez',
        text: 'Get me eyes on Metro Capital, and the guards’ cameras off for a minute.',
      },
    ],
  },
  'inez-outro': {
    title: 'The numbers do not add up',
    lines: [
      {
        speaker: 'Inez',
        text: 'Short by exactly what another bank is long. Money is not vanishing. It is moving.',
      },
      { speaker: 'Inez', text: 'Walt knows where it goes. Grand Reserve.' },
    ],
  },
  'walt-intro': {
    title: 'Grand Reserve',
    lines: [
      {
        speaker: 'Walt',
        text: 'Twenty years on that door. I know when they change the shift and who looks the other way.',
      },
      {
        speaker: 'Walt',
        text: 'My nephew has a message for you, if you can get him across town in one piece.',
      },
    ],
  },
  'walt-outro': {
    title: 'Walt’s old beat',
    lines: [
      {
        speaker: 'Walt',
        text: 'A delivery at three in the morning, never written down. That is where the money comes to rest.',
      },
      { speaker: 'Walt', text: 'Lena will want all of it. It all points to the Reserve.' },
    ],
  },
  'lena-intro': {
    title: 'Federal Vault',
    lines: [
      {
        speaker: 'Lena',
        text: 'I ran the books at Federal Vault until I read them. Marcus Vale made me an offer. I made a crew instead.',
      },
      {
        speaker: 'Lena',
        text: 'You have four pages. The last is in his vault. Know it before you walk in.',
      },
    ],
  },
  'lena-outro': {
    title: 'The Reserve',
    lines: [
      {
        speaker: 'Lena',
        text: 'Five pages, his signature on the first. The queries will do the rest.',
      },
      {
        speaker: 'Lena',
        text: 'You learned to read the truth out of a database. That is how it was always going to end.',
      },
    ],
  },
};

const DEFAULT_BARKS: Record<string, Record<string, string[]>> = {
  any: {
    intel: ['Good. Now you know a little more than they want you to.'],
    lock: ['One down. They will have heard that.'],
    vault: ['The vault is open. Grab it and go.'],
    getaway: ['Eyes up. They will block the way to the safehouse.'],
    complete: ['Banked. That is one more page of the case.'],
    failed: ['It happens. Come back with more intel.'],
    wanted: ['They are on you. Break line of sight and they lose interest.'],
    job: ['Nice work. Every favour counts.'],
  },
  'bank-1': {
    intel: ['Mae: Read it slowly. The answer is in the table.'],
    complete: ['Mae: There is the first page. Well done.'],
  },
  'bank-2': {
    intel: ['Dev: Every figure has a source. Find it.'],
    complete: ['Dev: Two ledgers. I knew it.'],
  },
  'bank-3': {
    intel: ['Inez: Group it, count it, compare it.'],
    complete: ['Inez: The totals check out. And they are wrong.'],
  },
  'bank-4': {
    intel: ['Walt: The guards keep a pattern. Learn it.'],
    complete: ['Walt: Out clean. Like the old days.'],
  },
  'bank-5': {
    intel: ['Lena: Do not rush. Vale never does.'],
    complete: ['Lena: That is the last page.'],
  },
};

const DEFAULT_FRAMES: Record<string, string> = {
  'vault:bank-1': 'Mae’s notes say this lock was set by someone who trusted the teller.',
  'vault:bank-2': 'Dev: the second ledger is behind this lock.',
  'vault:bank-3': 'Inez: the shortfall is in here. Crack it and count.',
  'vault:bank-4': 'Walt: the three o’clock delivery ends up behind this door.',
  'vault:bank-5': 'Lena: this is the last lock between us and Vale’s books.',
  'intel:bank-1': 'Mae asks: can you read this table?',
  'intel:bank-2': 'Dev asks: how do these accounts relate?',
  'intel:bank-3': 'Inez asks: what do the totals say?',
  'intel:bank-4': 'Walt asks: what pattern do the guards keep?',
  'intel:bank-5': 'Lena asks: what is Vale hiding?',
  job: 'The crew needs this done before the shift changes.',
};

export const DEFAULT_STORY_SETTINGS: StorySettings = storySettingsSchema.parse({});

/**
 * The line shown above a question to tie it to the story (Phase 32.4). It looks for the most
 * specific frame first: `vault:bank-3:lock-2`, then `vault:bank-3`, then `vault`, and so on
 * (`job:delivery` falls to `job`). No frame is a plain question.
 */
export function frameFor(
  rewardKey: string,
  frames: Readonly<Record<string, string>>,
): string | undefined {
  const parts = rewardKey.split(':');
  for (let n = parts.length; n >= 1; n--) {
    const found = frames[parts.slice(0, n).join(':')];
    if (found) return found;
  }
  return undefined;
}
