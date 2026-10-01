// src/app/queries/claims.queries.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { fetchClaims, fetchClaimDetail, submitClaim, fetchClaimsByStatus, ClaimSubmissionData } from '../api/claims.api';

export function useClaims() {
  return useQuery({
    queryKey: queryKeys.claims.lists(),
    queryFn: fetchClaims,
  });
}

export function useClaimDetail(claimId: string) {
  return useQuery({
    queryKey: queryKeys.claims.detail(claimId),
    queryFn: () => fetchClaimDetail(claimId),
    staleTime: 1000 * 60 * 2, // 2 min
    enabled: !!claimId,
  });
}

export function useClaimsByStatus(status: string) {
  return useQuery({
    queryKey: queryKeys.claims.byStatus(status),
    queryFn: () => fetchClaimsByStatus(status),
    enabled: !!status,
  });
}

export function useSubmitClaim() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: ClaimSubmissionData) => submitClaim(data),
    onSuccess: () => {
      // Only invalidate the lists; detail caches remain valid.
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.lists() });
    },
  });

  return {
    ...mutation,
    isLoading: mutation.isPending,
  };
}

// Re-export fetchClaimsByStatus from claims.api
export { fetchClaimsByStatus } from '../api/claims.api';
