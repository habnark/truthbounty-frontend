/**
 * Query hooks for evidence — projection of IPFS-anchored on-chain evidence entries.
 *
 * Authoritative source: on-chain EvidenceSubmitted events + IPFS CIDs.
 * No fabricated hashes, CIDs, or file metadata.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { fetchEvidence, fetchEvidenceDetail } from '../api/claims.api';

export function useEvidenceByClaim(claimId: string) {
  return useQuery({
    queryKey: queryKeys.evidence.byClaim(claimId),
    queryFn: () => fetchEvidence(claimId),
    enabled: !!claimId,
    staleTime: 1000 * 60 * 2, // 2 min — evidence rarely changes once submitted
  });
}

export function useEvidenceDetail(evidenceId: string) {
  return useQuery({
    queryKey: queryKeys.evidence.detail(evidenceId),
    queryFn: () => fetchEvidenceDetail(evidenceId),
    enabled: !!evidenceId,
    staleTime: 1000 * 60 * 5,
  });
}
