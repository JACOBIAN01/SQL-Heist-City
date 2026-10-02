import { z } from 'zod';
import type { QuestionTemplate } from '../questions/template';

/** Row in the admin question list. */
export interface QuestionSummary {
  readonly id: number;
  readonly slug: string;
  readonly title: string;
  readonly tier: number;
  readonly topics: readonly string[];
  readonly enabled: boolean;
  readonly version: number;
  readonly updatedAt: string;
}

export interface QuestionDetail extends QuestionSummary {
  readonly template: QuestionTemplate;
}

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const questionListQuerySchema = z.object({
  tier: z.coerce.number().int().min(1).max(5).optional(),
  topic: z.string().min(1).optional(),
  enabled: booleanQuery.optional(),
  /** Case-insensitive search in title and slug. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;
