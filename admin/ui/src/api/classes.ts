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

export function useRoster(id: number) {
  return useQuery({
    queryKey: ['class', id, 'roster'],
    queryFn: async () => (await api<{ roster: RosterEntry[] }>(`/classes/${id}/roster`)).roster,
  });
}
