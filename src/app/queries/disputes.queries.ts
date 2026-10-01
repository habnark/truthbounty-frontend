/**
 * Query hooks for disputes.
 *
 * Authoritative source: on-chain indexed dispute projections.
 *
 * Security rules:
 *  - Dispute IDs, vote counts, and stake amounts must come from the
 *    on-chain projection API; never fabricate or increment locally.
 *  - `createDispute` mutation invalidates only the scoped projection keys
 *    for the affected claim — never the entire disputes namespace.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  fetchDisputesByClaim,
  fetchDisputeDetail,
  createDispute,
  type CreateDisputePayload,
} from '../api/disputes.api';

/**
 * All disputes associated with a specific claim.
 */
export function useDisputesByClaim(claimId: string) {
  return useQuery({
    queryKey: queryKeys.disputes.byClaim(claimId),
    queryFn: () => fetchDisputesByClaim(claimId),
    enabled: !!claimId,
    staleTime: 1000 * 30, // 30 s — disputes can change during active voting
  });
}

/**
 * Single dispute detail by dispute ID.
 */
export function useDisputeDetail(disputeId: string) {
  return useQuery({
    queryKey: queryKeys.disputes.detail(disputeId),
    queryFn: () => fetchDisputeDetail(disputeId),
    enabled: !!disputeId,
    staleTime: 1000 * 30,
  });
}

/**
 * Mutation to create a new dispute.
 *
 * On success: invalidates the disputes projection for the affected claim and
 * the claim detail (which may reflect the new dispute state).
 * Does NOT invalidate disputes.all — no cache-wide churn.
 */
export function useCreateDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createDispute,
    onSuccess: (_data, variables: CreateDisputePayload) => {
      // Surgical invalidation: only the projections downstream of this claim.
      queryClient.invalidateQueries({
        queryKey: queryKeys.disputes.byClaim(variables.claimId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.detail(variables.claimId),
      });
    },
  });
}
