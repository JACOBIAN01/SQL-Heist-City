import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ImportReport,
  PreviewReport,
  QuestionDetail,
  QuestionSummary,
  QuestionTemplateInput,
} from '@heist/shared';
import { api } from './client';

export interface QuestionFilters {
  tier?: number;
  enabled?: boolean;
  topic?: string;
  q?: string;
}

export interface QuestionVersionInfo {
  version: number;
  createdBy: string | null;
  createdAt: string;
  template: QuestionTemplateInput;
}

const keys = {
  all: ['questions'] as const,
  list: (f: QuestionFilters) => ['questions', 'list', f] as const,
  one: (id: number) => ['questions', 'one', id] as const,
  versions: (id: number) => ['questions', 'versions', id] as const,
};

function toQuery(f: QuestionFilters): string {
  const params = new URLSearchParams();
  if (f.tier !== undefined) params.set('tier', String(f.tier));
  if (f.enabled !== undefined) params.set('enabled', String(f.enabled));
  if (f.topic) params.set('topic', f.topic);
  if (f.q) params.set('q', f.q);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useQuestions(filters: QuestionFilters) {
  return useQuery({
    queryKey: keys.list(filters),
    queryFn: async () =>
      (await api<{ questions: QuestionSummary[] }>(`/questions${toQuery(filters)}`)).questions,
  });
}

export function useQuestion(id: number | undefined) {
  return useQuery({
    queryKey: keys.one(id ?? 0),
    queryFn: async () => (await api<{ question: QuestionDetail }>(`/questions/${id}`)).question,
    enabled: id !== undefined,
  });
}

export function useQuestionVersions(id: number) {
  return useQuery({
    queryKey: keys.versions(id),
    queryFn: async () =>
      (await api<{ versions: QuestionVersionInfo[] }>(`/questions/${id}/versions`)).versions,
  });
}

/** Any question change invalidates all question queries (lists are cheap). */
function useQuestionMutation<A>(fn: (arg: A) => Promise<QuestionDetail | undefined>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}

export const useSetEnabled = () =>
  useQuestionMutation(
    async ({ id, enabled }: { id: number; enabled: boolean }) =>
      (
        await api<{ question: QuestionDetail }>(
          `/questions/${id}/${enabled ? 'enable' : 'disable'}`,
          { method: 'POST' },
        )
      ).question,
  );

export const useDuplicate = () =>
  useQuestionMutation(
    async (id: number) =>
      (await api<{ question: QuestionDetail }>(`/questions/${id}/duplicate`, { method: 'POST' }))
        .question,
  );

export const useSaveQuestion = () =>
  useQuestionMutation(async ({ id, template }: { id?: number; template: unknown }) =>
    id === undefined
      ? (await api<{ question: QuestionDetail }>('/questions', { method: 'POST', body: template }))
          .question
      : (
          await api<{ question: QuestionDetail }>(`/questions/${id}`, {
            method: 'PUT',
            body: template,
          })
        ).question,
  );

export const useDeleteQuestion = () =>
  useQuestionMutation(async (id: number) => {
    await api(`/questions/${id}`, { method: 'DELETE' });
    return undefined;
  });

export const useRollback = () =>
  useQuestionMutation(
    async ({ id, version }: { id: number; version: number }) =>
      (
        await api<{ question: QuestionDetail }>(`/questions/${id}/rollback/${version}`, {
          method: 'POST',
        })
      ).question,
  );

export function usePreview() {
  return useMutation({
    mutationFn: async (req: {
      id?: number;
      template?: unknown;
      seeds?: string[];
      studentSql?: string;
    }) => {
      const body = {
        ...(req.seeds ? { seeds: req.seeds } : {}),
        ...(req.studentSql ? { studentSql: req.studentSql } : {}),
      };
      const path = req.id === undefined ? '/questions/preview' : `/questions/${req.id}/preview`;
      return (
        await api<{ report: PreviewReport }>(path, {
          method: 'POST',
          body: req.id === undefined ? { ...body, template: req.template } : body,
        })
      ).report;
    },
  });
}

export function useImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (req: {
      body: string;
      csv: boolean;
      dryRun: boolean;
      onConflict: 'skip' | 'update';
    }) => {
      const qs = `?dryRun=${req.dryRun}&onConflict=${req.onConflict}`;
      return (
        await api<{ report: ImportReport }>(`/questions/import${qs}`, {
          method: 'POST',
          body: req.body,
          rawContentType: req.csv ? 'text/csv' : 'application/json',
        })
      ).report;
    },
    onSuccess: (report) => {
      if (!report.dryRun) void client.invalidateQueries({ queryKey: keys.all });
    },
  });
}
