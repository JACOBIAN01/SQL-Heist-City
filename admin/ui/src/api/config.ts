import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChallengeSettings,
  CombatSettings,
  RewardTierEntry,
  TutorialSettings,
} from '@heist/shared';
import { api } from './client';

export function useChallengeSettings() {
  return useQuery({
    queryKey: ['config', 'settings'],
    queryFn: async () =>
      (
        await api<{ challenges: { current: ChallengeSettings; defaults: ChallengeSettings } }>(
          '/config/settings',
        )
      ).challenges,
  });
}

export function useSaveChallengeSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<ChallengeSettings>) =>
      api<{ challenges: ChallengeSettings }>('/config/settings', {
        method: 'PUT',
        body: { challenges: changes },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useRewardMap() {
  return useQuery({
    queryKey: ['config', 'rewards'],
    queryFn: async () => (await api<{ rewards: RewardTierEntry[] }>('/config/reward-map')).rewards,
  });
}

export function useSaveRewardMap() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rewards: { key: string; min: number; max: number }[]) =>
      api<{ rewards: RewardTierEntry[] }>('/config/reward-map', {
        method: 'PUT',
        body: { rewards },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useCombatSettings() {
  return useQuery({
    queryKey: ['config', 'combat'],
    queryFn: async () =>
      (
        await api<{ combat: { current: CombatSettings; defaults: CombatSettings } }>(
          '/config/combat',
        )
      ).combat,
  });
}

export function useSaveCombatSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<CombatSettings>) =>
      api<{ combat: CombatSettings }>('/config/combat', {
        method: 'PUT',
        body: { combat: changes },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useTutorialSettings() {
  return useQuery({
    queryKey: ['config', 'tutorial'],
    queryFn: async () =>
      (
        await api<{ tutorial: { current: TutorialSettings; defaults: TutorialSettings } }>(
          '/config/tutorial',
        )
      ).tutorial,
  });
}

export function useSaveTutorialSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<TutorialSettings>) =>
      api<{ tutorial: TutorialSettings }>('/config/tutorial', {
        method: 'PUT',
        body: { tutorial: changes },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['config'] }),
  });
}
