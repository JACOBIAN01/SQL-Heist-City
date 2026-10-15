import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AxisScore,
  BriefMark,
  BriefView,
  ProfileScopeView,
  RcsbeDimension,
  ShapeRow,
} from '@heist/shared';
import { api } from './client';

export interface StudentRow {
  playerId: number;
  name: string;
  rcsbe: AxisScore[];
  bloom: AxisScore[];
}

export interface Spread {
  dimension: string;
  students: number;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
}

export interface ClassAnalytics {
  target: Record<RcsbeDimension, number>;
  class: ProfileScopeView;
  students: StudentRow[];
  spread: { rcsbe: Spread[]; bloom: Spread[] };
  paper: { rows: ShapeRow[]; problems: string[]; questions: number };
}

/** The class profile, refreshed every few seconds so a teacher can watch a match. */
export function useClassAnalytics(id: number) {
  return useQuery({
    queryKey: ['class', id, 'analytics'],
    queryFn: () => api<ClassAnalytics>(`/classes/${id}/analytics`),
    refetchInterval: 3000,
  });
}

export interface StudentAnalytics {
  player: { id: number; name: string };
  profile: ProfileScopeView;
  classProfile: ProfileScopeView;
  target: Record<RcsbeDimension, number>;
  trend: { round: number; rcsbe: AxisScore[] }[];
  topics: {
    topic: string;
    earned: number;
    available: number;
    items: number;
    solved: number;
    score: number | null;
  }[];
  weakestTopics: { topic: string; score: number | null }[];
  remediation: AxisScore | null;
  items: number;
}

export function useStudentAnalytics(classId: number, playerId: number) {
  return useQuery({
    queryKey: ['class', classId, 'student', playerId],
    queryFn: () => api<StudentAnalytics>(`/classes/${classId}/students/${playerId}`),
    refetchInterval: 3000,
  });
}

export interface ItemRow {
  questionId: number;
  slug: string | null;
  title: string;
  rcsbe: string;
  tier: number;
  attempts: number;
  students: number;
  solveRate: number;
  wrongRate: number;
  medianSeconds: number | null;
  discrimination: number | null;
  flags: string[];
}

export function useItemAnalysis(classId: number) {
  return useQuery({
    queryKey: ['class', classId, 'items'],
    queryFn: async () => (await api<{ items: ItemRow[] }>(`/classes/${classId}/items`)).items,
  });
}

export interface AssessmentView {
  id: number;
  classId: number;
  kind: 'pre' | 'post';
  questionIds: number[];
  open: boolean;
}

export function useAssessments(classId: number) {
  return useQuery({
    queryKey: ['class', classId, 'assessments'],
    queryFn: () =>
      api<{ pre: AssessmentView | null; post: AssessmentView | null }>(
        `/classes/${classId}/assessments`,
      ),
  });
}

export function useSaveAssessment(classId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      ...body
    }: {
      kind: 'pre' | 'post';
      questionIds: number[];
      open: boolean;
    }) =>
      api<{ assessment: AssessmentView }>(`/classes/${classId}/assessments/${kind}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['class', classId, 'assessments'] }),
  });
}

export interface GainRow {
  dimension: string;
  pre: number | null;
  post: number | null;
  gain: number | null;
}

export interface GainView {
  class: { rcsbe: GainRow[]; bloom: GainRow[] };
  students: { playerId: number; name: string; rcsbe: GainRow[] }[];
  taken: { pre: number; post: number };
}

export function useGain(classId: number) {
  return useQuery({
    queryKey: ['class', classId, 'gain'],
    queryFn: () => api<GainView>(`/classes/${classId}/gain`),
  });
}

export type BriefStatus = 'unmarked' | 'marked' | 'all';

/** The marking queue: open briefs from the teacher's classes (all classes for an admin). */
export function useBriefs(status: BriefStatus) {
  return useQuery({
    queryKey: ['briefs', status],
    queryFn: () => api<{ briefs: BriefView[] }>(`/briefs?status=${status}`),
  });
}

export function useMarkBrief() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mark }: { id: string; mark: BriefMark }) =>
      api<{ brief: BriefView }>(`/briefs/${encodeURIComponent(id)}/mark`, {
        method: 'POST',
        body: mark,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['briefs'] }),
  });
}
