import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, AuditEntry, Pool, Role } from '@heist/shared';
import { api } from './client';

// --- Pools
export function usePools() {
  return useQuery({
    queryKey: ['pools'],
    queryFn: async () => (await api<{ pools: Pool[] }>('/pools')).pools,
  });
}

export function useSavePool() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id?: number;
      name: string;
      description: string;
      questionIds: number[];
    }) =>
      id === undefined
        ? api<{ pool: Pool }>('/pools', { method: 'POST', body })
        : api<{ pool: Pool }>(`/pools/${id}`, { method: 'PUT', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['pools'] }),
  });
}

export function useDeletePool() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/pools/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['pools'] }),
  });
}

// --- Audit
export function useAudit(entity: string, before?: number) {
  const qs = new URLSearchParams({ limit: '50' });
  if (entity) qs.set('entity', entity);
  if (before) qs.set('before', String(before));
  return useQuery({
    queryKey: ['audit', entity, before],
    queryFn: async () => (await api<{ entries: AuditEntry[] }>(`/audit?${qs}`)).entries,
  });
}

// --- Users
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api<{ users: AdminUser[] }>('/users')).users,
  });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; role: Role }) =>
      api<{ user: AdminUser }>('/users', { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      role?: Role;
      disabled?: boolean;
      password?: string;
    }) => api<{ user: AdminUser }>(`/users/${id}`, { method: 'PUT', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  });
}
