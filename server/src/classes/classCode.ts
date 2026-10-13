import { randomInt } from 'node:crypto';

/** No 0/O, 1/I/L, 2/Z or 5/S: a code read out loud or copied by hand stays unambiguous. */
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY3456789';
export const CODE_LENGTH = 6;

/** A random class code: 28^6 ≈ 480 million, so guessing one is hopeless (joins are also rate-limited). */
export function newClassCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[random(ALPHABET.length)];
  return code;
}

/** What a student typed, tidied: upper case, spaces and dashes removed. */
export function normaliseClassCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, '');
}

export const isClassCode = (code: string): boolean =>
  new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code);
