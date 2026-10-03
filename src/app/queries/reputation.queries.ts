/**
 * Query hooks for on-chain reputation scores.
 *
 * Reputation is an indexed projection of on-chain verification outcomes;
 * it must never be fabricated or incremented locally.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { fetchUserReputation } from '../api/user.api';

export function useReputationByUser(userId: string) {
  return useQuery({
    queryKey: queryKeys.reputation.byUser(userId),
    queryFn: () => fetchUserReputation(userId),
    enabled: !!userId,
    staleTime: 1000 * 60, // 1 min — refreshed via WS events
  });
}
