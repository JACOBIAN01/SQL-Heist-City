import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomHeistSpec } from '@heist/shared';
import { api } from './client';

export interface CustomHeist {
  id: number;
  name: string;
  spec: CustomHeistSpec;
  shareCode: string;
  /** The mode a class takes to play it. */
  mode: string;
}

export function useCustomHeists() {
  return useQuery({
    queryKey: ['custom-heists'],
    queryFn: async () => (await api<{ heists: CustomHeist[] }>('/custom-heists')).heists,
  });
}

export function useSaveCustomHeist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, spec }: { id?: number; spec: CustomHeistSpec }) =>
      id === undefined
        ? api<{ heist: CustomHeist }>('/custom-heists', { method: 'POST', body: spec })
        : api<{ heist: CustomHeist }>(`/custom-heists/${id}`, { method: 'PUT', body: spec }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['custom-heists'] }),
  });
}

export function useDeleteCustomHeist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/custom-heists/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['custom-heists'] }),
  });
}

export function useImportCustomHeist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<{ heist: CustomHeist }>('/custom-heists/import', { method: 'POST', body: { code } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['custom-heists'] }),
  });
}
