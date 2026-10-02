import { useQuery } from '@tanstack/react-query';
import type { AdminUser } from '@heist/shared';
import { ApiError, api } from '../api/client';

export const meQueryKey = ['me'] as const;

/** Current user, or null when logged out (401). */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return (await api<{ user: AdminUser }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}
