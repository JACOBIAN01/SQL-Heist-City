import { z } from 'zod';

/**
 * What a display name may be (13.8). Defaults only: the admin edits the word
 * lists, which differ by school and language. The default list is a start, not
 * a guarantee; schools add their own words.
 */
export const nameRulesSchema = z.object({
  minLength: z.number().int().min(1).max(20).default(2),
  maxLength: z.number().int().min(2).max(20).default(20),
  /** Words that may not appear in a name, even disguised (`sh1t`, `s.h.i.t`). */
  blocked: z
    .array(z.string().min(2).max(40))
    .max(2000)
    .default([
      'fuck',
      'shit',
      'bitch',
      'cunt',
      'dick',
      'cock',
      'pussy',
      'asshole',
      'bastard',
      'whore',
      'slut',
      'nigg',
      'fagg',
      'rape',
      'nazi',
      'hitler',
    ]),
  /** Names that contain a blocked word by accident and are fine (checked as whole names). */
  allowed: z.array(z.string().min(1).max(40)).max(2000).default(['dickens', 'cockburn']),
});

export type NameRules = z.infer<typeof nameRulesSchema>;
export const DEFAULT_NAME_RULES: NameRules = nameRulesSchema.parse({});

export type NameVerdict =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'too_short' | 'too_long' | 'characters' | 'blocked' };

const LOOKALIKES: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Lower case, look-alike digits and symbols turned into letters, everything else dropped. */
export function normaliseForFilter(text: string): string {
  const letters = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/[^\p{L}]/gu, '');
  // "fuuuck" → "fuck": runs of the same letter count once.
  return letters.replace(/(\p{L})\1+/gu, '$1');
}

/** Cleans a typed name and decides whether it may be used. */
export function checkDisplayName(raw: string, rules: NameRules = DEFAULT_NAME_RULES): NameVerdict {
  const name = raw.replace(/\s+/gu, ' ').trim();
  const length = [...name].length;
  if (length < rules.minLength) return { ok: false, reason: 'too_short' };
  if (length > rules.maxLength) return { ok: false, reason: 'too_long' };
  // Letters, digits and a few joiners: no markup, links, control or invisible characters.
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u.test(name)) return { ok: false, reason: 'characters' };
  const flat = normaliseForFilter(name);
  const allowed = new Set(rules.allowed.map(normaliseForFilter));
  if (!allowed.has(flat) && rules.blocked.some((w) => flat.includes(normaliseForFilter(w))))
    return { ok: false, reason: 'blocked' };
  return { ok: true, name };
}

export const NAME_REASONS: Readonly<Record<string, string>> = {
  too_short: 'That name is too short.',
  too_long: 'That name is too long.',
  characters: 'Use letters, numbers, spaces and . _ - only.',
  blocked: 'That name is not allowed.',
};
