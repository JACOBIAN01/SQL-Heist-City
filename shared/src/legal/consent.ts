/**
 * What a school agrees to before a class can start, and what a student must confirm before
 * playing (Phase 21.3, 21.7). The wording is a DRAFT for the owner's legal reviewer
 * (docs/legal/README.md); changing it means raising `CONSENT_VERSION`, which asks every class's
 * teacher to accept again.
 */
export const CONSENT_VERSION = 1;

export interface ConsentStatement {
  readonly id: string;
  readonly text: string;
}

export const CONSENT_STATEMENTS: readonly ConsentStatement[] = [
  {
    id: 'authority',
    text: "I am a teacher or administrator of my school and I am authorised to agree to these terms on the school's behalf, including for students who are under 18 or under 13 where the school may give consent in place of a parent or guardian.",
  },
  {
    id: 'documents',
    text: 'I have read the Privacy Policy, the Terms and the Data Processing Agreement, and the school accepts them.',
  },
  {
    id: 'data',
    text: 'I understand what is kept about each student: their Google account name and email, the display name they choose, which classes they joined, and a learning record (each question they were asked, how they answered, and the profile worked out from it). Nothing else is collected, and no advertising or sale of data happens.',
  },
  {
    id: 'violence',
    text: "I understand that the game is violent. Students' characters shoot each other with guns and run each other over in a cartoon-style city while solving SQL questions. There is no blood or gore, and no way to play without the shooting. The school has decided that this is suitable for the students in this class.",
  },
  {
    id: 'families',
    text: "The school will tell parents or guardians about the game and how their children's data is used where the law or school policy requires.",
  },
  {
    id: 'rights',
    text: "The school can ask for any student's data to be exported or deleted at any time, and students can do so themselves from the menu.",
  },
];

/** A class's record of having accepted the terms. */
export interface ClassConsent {
  readonly version: number;
  /** The staff account that accepted (kept for the school's own records). */
  readonly byUserId: number | null;
  readonly at: string;
}

/** Whether a class has accepted the current terms. */
export const consentIsCurrent = (consent: ClassConsent | null | undefined): boolean =>
  consent !== null && consent !== undefined && consent.version === CONSENT_VERSION;

/** What a student has said about their age. Only the verdict is kept, never the birth year. */
export const AGE_STATUSES = ['unknown', 'ok', 'too_young'] as const;
export type AgeStatus = (typeof AGE_STATUSES)[number];

/**
 * The verdict for a declared birth year. Lenient by a year (a birthday later in the year is not
 * asked about), so someone exactly `minAge` years off by calendar year passes.
 */
export function ageStatusFor(birthYear: number, thisYear: number, minAge: number): AgeStatus {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > thisYear) return 'unknown';
  return thisYear - birthYear >= minAge ? 'ok' : 'too_young';
}
