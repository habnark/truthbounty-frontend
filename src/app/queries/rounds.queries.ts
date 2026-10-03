/**
 * Query hooks for verification rounds.
 *
 * Authoritative source: on-chain indexed projection.
 * Never fabricate round IDs, deadlines, or vote counts.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { fetchRoundsByClaim, fetchRoundDetail } from '../api/claims.api';

export function useRoundsByClaim(claimId: string) {
  return useQuery({
    queryKey: queryKeys.rounds.byClaim(claimId),
    queryFn: () => fetchRoundsByClaim(claimId),
    enabled: !!claimId,
    staleTime: 1000 * 30, // 30 s — rounds can change during active voting
  });
}

export function useRoundDetail(roundId: string) {
  return useQuery({
    queryKey: queryKeys.rounds.detail(roundId),
    queryFn: () => fetchRoundDetail(roundId),
    enabled: !!roundId,
    staleTime: 1000 * 30,
  });
}
