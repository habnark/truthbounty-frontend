/**
 * useReputation
 *
 * Query-backed hook for on-chain reputation scores.
 *
 * Replaces the previous local-state-only implementation that allowed
 * arbitrary client-side score mutations. Reputation is now read from
 * the indexer API and updated only via projection-stream events.
 */

'use client';

import type { UserReputation } from '@/app/api/user.api';
import { useReputationByUser } from '@/app/queries/reputation.queries';

export interface UseReputationReturn {
  reputation: UserReputation | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useReputation(userId: string): UseReputationReturn {
  const { data: reputation, isLoading, isError } = useReputationByUser(userId);

  return {
    reputation,
    isLoading,
    isError,
  };
}
