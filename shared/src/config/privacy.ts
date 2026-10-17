import { z } from 'zod';

/**
 * Privacy settings (Phase 21), editable by an admin. Days of 0 mean "keep".
 * What each number does is in docs/privacy.md.
 */
export const privacySettingsSchema = z.object({
  /** Youngest age allowed to play, by the year of birth a student gives (it is not stored). */
  minAge: z.number().int().min(5).max(18).default(13),
  /** A student account not used for this many days is deleted, with everything keyed to it. */
  inactiveAccountDays: z.number().int().min(0).default(365),
  /** An archived class is deleted (rosters, results) this many days after archiving. */
  archivedClassDays: z.number().int().min(0).default(180),
  /** Marked or unmarked open briefs are deleted this many days after being handed in. */
  briefDays: z.number().int().min(0).default(730),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = privacySettingsSchema.parse({});
