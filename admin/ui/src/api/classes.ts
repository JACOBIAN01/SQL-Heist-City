import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClassInput,
  ClassQuestionLink,
  ClassQuestionView,
  ClassRecord,
  RosterEntry,
} from '@heist/shared';
import { api } from './client';

export function useClasses(includeArchived = false) {
  return useQuery({
    queryKey: ['classes', includeArchived],
    queryFn: async () =>
      (await api<{ classes: ClassRecord[] }>(`/classes${includeArchived ? '?archived=1' : ''}`))
        .classes,
  });
}

export function useClass(id: number) {
  return useQuery({
    queryKey: ['class', id],
    queryFn: async () => (await api<{ class: ClassRecord }>(`/classes/${id}`)).class,
  });
}

export function useCreateClass() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<ClassInput, 'name'> & Partial<ClassInput>) =>
      api<{ class: ClassRecord }>('/classes', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['classes'] }),
  });
}

export function useUpdateClass(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<ClassInput>) =>
      api<{ class: ClassRecord }>(`/classes/${id}`, { method: 'PUT', body: changes }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['classes'] });
      void client.invalidateQueries({ queryKey: ['class', id] });
    },
  });
}

/** The school accepts the terms for this class (Phase 21.3). */
export function useAcceptConsent(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { version: number; accepted: string[] }) =>
      api<{ class: ClassRecord }>(`/classes/${id}/consent`, { method: 'POST', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['classes'] });
      void client.invalidateQueries({ queryKey: ['class', id] });
    },
  });
}

export function useArchiveClass() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/classes/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['classes'] }),
  });
}

export function useNewCode(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ class: ClassRecord }>(`/classes/${id}/code`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['classes'] });
      void client.invalidateQueries({ queryKey: ['class', id] });
    },
  });
}

export function useClassQuestions(id: number) {
  return useQuery({
    queryKey: ['class', id, 'questions'],
    queryFn: async () =>
      (await api<{ links: ClassQuestionView[] }>(`/classes/${id}/questions`)).links,
  });
}

export function useSaveClassQuestions(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (links: ClassQuestionLink[]) =>
      api(`/classes/${id}/questions`, { method: 'PUT', body: { links } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['class', id] }),
  });
}

export interface SquadsView {
  mode: 'off' | 'teacher' | 'self' | 'auto';
  size: number;
  /** The most squads there can be. */
  max: number;
  /** Student id → squad number. */
  assignments: Record<string, number>;
}

export function useSquads(id: number) {
  return useQuery({
    queryKey: ['class', id, 'squads'],
    queryFn: () => api<SquadsView>(`/classes/${id}/squads`),
  });
}

export function useSaveSquads(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assignments: Record<string, number>) =>
      api<SquadsView>(`/classes/${id}/squads`, { method: 'PUT', body: { assignments } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['class', id, 'squads'] }),
  });
}

export function useBalanceSquads(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<SquadsView>(`/classes/${id}/squads/balance`, { method: 'POST', body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['class', id] }),
  });
}

export function useRoster(id: number) {
  return useQuery({
    queryKey: ['class', id, 'roster'],
    queryFn: async () => (await api<{ roster: RosterEntry[] }>(`/classes/${id}/roster`)).roster,
  });
}

export interface LiveStatus {
  status: { state: 'waiting' | 'live'; port?: number; players?: number; maxPlayers?: number };
  /** False when the admin cannot reach the game server. */
  connected: boolean;
}

/** The class room's state, looked at every few seconds. */
export function useLive(id: number) {
  return useQuery({
    queryKey: ['class', id, 'live'],
    queryFn: () => api<LiveStatus>(`/classes/${id}/live`),
    refetchInterval: 3000,
  });
}

export type LiveAction = 'start' | 'stop' | 'end-round' | 'next-round';

export function useLiveCommand(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      command: { action: LiveAction } | { kick: number } | { rename: number; name: string },
    ) => {
      if ('action' in command)
        return api(`/classes/${id}/live/${command.action}`, { method: 'POST' });
      if ('kick' in command)
        return api(`/classes/${id}/live/kick`, {
          method: 'POST',
          body: { playerId: command.kick },
        });
      return api(`/classes/${id}/live/rename`, {
        method: 'POST',
        body: { playerId: command.rename, displayName: command.name },
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['class', id, 'live'] });
      void client.invalidateQueries({ queryKey: ['class', id, 'roster'] });
    },
  });
}

export function useLockClass(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (locked: boolean) =>
      api<{ class: ClassRecord }>(`/classes/${id}/lock`, { method: 'POST', body: { locked } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['class', id] });
      void client.invalidateQueries({ queryKey: ['classes'] });
    },
  });
}

export interface RoundSummary {
  id: number;
  number: number;
  startedAt: string;
  endedAt: string;
  players: number;
  winner: { name: string; banked: number } | null;
}

export interface RoundDetail {
  round: RoundSummary & { awards: { id: string; name: string; value: number }[] };
  standings: { rank: number; name: string; banked: number; kills: number; deaths: number }[];
}

export function useRounds(id: number) {
  return useQuery({
    queryKey: ['class', id, 'rounds'],
    queryFn: async () => (await api<{ rounds: RoundSummary[] }>(`/classes/${id}/results`)).rounds,
  });
}

export function useRound(id: number, roundId: number | undefined) {
  return useQuery({
    queryKey: ['class', id, 'rounds', roundId],
    enabled: roundId !== undefined,
    queryFn: () => api<RoundDetail>(`/classes/${id}/results/${roundId}`),
  });
}

export interface LeagueRowView {
  rank: number;
  name: string;
  points: number;
  learningPoints: number;
  cashPoints: number;
  roundPoints: number;
  earned: number;
  available: number;
  banked: number;
  rounds: number;
}

export interface LeagueView {
  week: { start: string; end: string };
  rows: LeagueRowView[];
}

/** The weekly league of a class (a week is given by its Monday; this week when omitted). */
export function useLeague(id: number, week: string | undefined) {
  return useQuery({
    queryKey: ['class', id, 'league', week ?? 'now'],
    queryFn: () => api<LeagueView>(`/classes/${id}/league${week ? `?week=${week}` : ''}`),
  });
}

export interface ConceptCardView {
  topic: string;
  title: string;
  nudge: string;
  body_md: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export function useConcepts() {
  return useQuery({
    queryKey: ['concepts'],
    queryFn: async () => (await api<{ cards: ConceptCardView[] }>('/concepts')).cards,
  });
}

export function useSaveConcept() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      topic,
      ...body
    }: {
      topic: string;
      title: string;
      nudge: string;
      body_md: string;
    }) => api<{ card: ConceptCardView }>(`/concepts/${topic}`, { method: 'PUT', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['concepts'] }),
  });
}
