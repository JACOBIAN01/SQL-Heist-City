import { z } from 'zod';

/**
 * A short explainer for one SQL topic (Phase 16.1). Players see it after a
 * round, as a hint step and in the post-round review; teachers edit it.
 */
export const conceptCardSchema = z.object({
  /** Matches a question's `topic` entries (kebab-case). */
  topic: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
  title: z.string().trim().min(1).max(80),
  /** One line: the free first step of the hint ladder. */
  nudge: z.string().trim().min(1).max(200),
  /** The explainer, in simple Markdown (bold, `code`, short examples). */
  body_md: z.string().trim().min(1).max(2000),
});

export type ConceptCard = z.infer<typeof conceptCardSchema>;

export const conceptFileSchema = z.object({
  format: z.literal('heist-concepts'),
  version: z.number().int(),
  cards: z.array(conceptCardSchema),
});

/** A stored card with its history. */
export interface StoredConcept extends ConceptCard {
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}
