/**
 * Query hooks for reward state.
 *
 * Authoritative source: on-chain indexed reward projections.
 * Amounts are exact integers (bigint-safe strings from the API) — never
 * fabricated from local state or mock data.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { fetchClaimableRewards, fetchRewardHistory } from '../api/user.api';

/**
 * Claimable rewards for a connected wallet address.
 * `address` must be a checksummed Ethereum address string.
 */
export function useClaimableRewards(address: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rewards.claimable(address ?? ''),
    queryFn: () => fetchClaimableRewards(address!),
    enabled: !!address,
    staleTime: 1000 * 30, // 30 s — rewards are projection-stream updated
  });
}

/**
 * Historical reward log for a wallet address.
 */
export function useRewardHistory(address: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rewards.history(address ?? ''),
    queryFn: () => fetchRewardHistory(address!),
    enabled: !!address,
    staleTime: 1000 * 60 * 5,
  });
}
