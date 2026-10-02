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

export const previewRequestSchema = z.object({
  /** Seeds to instantiate; default: a few fixed preview seeds. */
  seeds: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
  /** Optional student query to grade against every seed. */
  studentSql: z.string().max(20_000).optional(),
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export type PreviewIssue = 'error' | 'empty' | 'truncated' | 'slow';

export interface PreviewTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number | null)[])[];
}

export interface SeedPreview {
  readonly seed: string;
  readonly story?: string;
  readonly referenceSql?: string;
  readonly tables?: readonly PreviewTable[];
  readonly expected?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly (string | number | null)[])[];
  };
  readonly runtimeMs: number;
  readonly issues: readonly PreviewIssue[];
  readonly error?: string;
  /** Present when a studentSql was given. */
  readonly student?: {
    readonly status: string;
    readonly feedback?: { readonly code: string; readonly message: string };
  };
}

export interface PreviewReport {
  readonly seeds: readonly SeedPreview[];
  /** Share of seeds whose expected result differs from every other seed's (anti-copy health). */
  readonly distinctResultRatio: number;
  readonly ok: boolean;
}
