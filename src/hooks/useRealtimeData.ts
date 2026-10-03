// src/hooks/useRealtimeData.ts
//
// Projection-aware cache invalidation driven by WebSocket stream events.
//
// Design rules:
//  1. Always use canonical query key factories — never raw string arrays.
//  2. Prefer setQueryData for events that carry the full new payload
//     (avoids an unnecessary round-trip fetch).
//  3. Use invalidateQueries only when the event does NOT carry the full
//     payload or when we need to bust a list that is otherwise hard to
//     update surgically.
//  4. Never fabricate hashes, amounts, or verdicts from event metadata.

'use client';

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/components/providers/WebSocketProvider';
import { queryKeys } from '@/app/queries/queryKeys';
import type {
  ClaimCreatedEvent,
  ClaimUpdatedEvent,
  ClaimStatusChangedEvent,
  VerificationAddedEvent,
  DisputeCreatedEvent,
  DisputeResolvedEvent,
  LeaderboardUpdatedEvent,
  UserStatsUpdatedEvent,
} from '@/app/types/websocket';
import { sortAndNormalizeLeaderboard } from '@/lib/leaderboard';

/**
 * Hook that integrates WebSocket projection-stream events with TanStack Query
 * cache.  Each handler targets the narrowest possible key set so that
 * unrelated data is never evicted.
 */
export function useRealtimeData() {
  const { subscribe, isConnected } = useWebSocketContext();
  const queryClient = useQueryClient();

  // ------------------------------------------------------------------
  // CLAIM_CREATED — prepend to the unfiltered claims list; no full refetch.
  // ------------------------------------------------------------------
  const handleClaimCreated = useCallback(
    (payload: ClaimCreatedEvent) => {
      queryClient.setQueryData(queryKeys.claims.lists(), (old: unknown) => {
        if (Array.isArray(old)) {
          return [payload.claim, ...old];
        }
        return [payload.claim];
      });
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // CLAIM_UPDATED — surgical update on both detail and list caches.
  // ------------------------------------------------------------------
  const handleClaimUpdated = useCallback(
    (payload: ClaimUpdatedEvent) => {
      // Update detail entry.
      queryClient.setQueryData(
        queryKeys.claims.detail(payload.claimId),
        (old: unknown) => {
          if (old && typeof old === 'object') {
            return { ...old, ...payload.updates };
          }
          return old;
        },
      );

      // Patch the claim inside the list without refetching the whole list.
      queryClient.setQueryData(queryKeys.claims.lists(), (old: unknown) => {
        if (Array.isArray(old)) {
          return (old as Array<{ id: string } & Record<string, unknown>>).map((claim) =>
            claim.id === payload.claimId
              ? { ...claim, ...payload.updates }
              : claim,
          );
        }
        return old;
      });
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // CLAIM_STATUS_CHANGED — update status field + invalidate finality
  // projection so it is re-evaluated on next read.
  // ------------------------------------------------------------------
  const handleClaimStatusChanged = useCallback(
    (payload: ClaimStatusChangedEvent) => {
      queryClient.setQueryData(
        queryKeys.claims.detail(payload.claimId),
        (old: unknown) => {
          if (old && typeof old === 'object') {
            return {
              ...old,
              status: payload.newStatus,
              updatedAt:
                (payload.claim as { updatedAt?: string } | undefined)?.updatedAt ??
                new Date().toISOString(),
            };
          }
          return old;
        },
      );

      queryClient.setQueryData(queryKeys.claims.lists(), (old: unknown) => {
        if (Array.isArray(old)) {
          return (old as Array<{ id: string } & Record<string, unknown>>).map((claim) =>
            claim.id === payload.claimId
              ? { ...claim, status: payload.newStatus }
              : claim,
          );
        }
        return old;
      });

      // Invalidate claim detail to get fresh status
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.detail(payload.claimId),
      });

      // Bust the finality projection cache for this claim so any
      // displayed finality badge re-derives from fresh on-chain data.
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.finality(payload.claimId),
      });

      // Bust status-filtered lists that may now be stale.
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.byStatus(payload.newStatus),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.byStatus(payload.previousStatus),
      });
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // VERIFICATION_ADDED — invalidate the claim detail (verifier count
  // changed) + the user's verification history.
  // ------------------------------------------------------------------
  const handleVerificationAdded = useCallback(
    (payload: VerificationAddedEvent) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.detail(payload.claimId),
      });

      // Invalidate the verification list for this claim.
      queryClient.invalidateQueries({
        queryKey: queryKeys.verifications.byClaim(payload.claimId),
      });

      // Invalidate the verifier's user profile.
      if (payload.verification.verifierAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.user.profile(payload.verification.verifierAddress),
        });
      }

      // Invalidate the verifier's own reputation projection.
      const verifierAddress = payload.verification.verifierAddress;
      if (verifierAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.reputation.byUser(verifierAddress),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.user.reputation(verifierAddress),
        });
      }
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // DISPUTE_CREATED — invalidate claim detail + disputes namespace.
  // ------------------------------------------------------------------
  const handleDisputeCreated = useCallback(
    (payload: DisputeCreatedEvent) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.detail(payload.claimId),
      });

      // Invalidate the disputes for this claim (not all disputes).
      queryClient.invalidateQueries({
        queryKey: queryKeys.disputes.byClaim(payload.claimId),
      });
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // DISPUTE_RESOLVED — invalidate claim detail + the specific dispute +
  // rewards (outcome may have changed claimable amounts).
  // ------------------------------------------------------------------
  const handleDisputeResolved = useCallback(
    (payload: DisputeResolvedEvent) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.detail(payload.claimId),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.disputes.detail(payload.disputeId),
      });

      // Dispute finality projection is now stale.
      queryClient.invalidateQueries({
        queryKey: queryKeys.disputes.finality(payload.disputeId),
      });

      // Reward projections may have changed due to outcome.
      queryClient.invalidateQueries({
        queryKey: queryKeys.rewards.all,
      });
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // LEADERBOARD_UPDATED — write-through; no refetch needed.
  // ------------------------------------------------------------------
  const handleLeaderboardUpdated = useCallback(
    (payload: LeaderboardUpdatedEvent) => {
      queryClient.setQueryData(
        queryKeys.leaderboard,
        sortAndNormalizeLeaderboard(payload.rankings),
      );
    },
    [queryClient],
  );

  // ------------------------------------------------------------------
  // USER_STATS_UPDATED — targeted reputation + user profile busts.
  // ------------------------------------------------------------------
  const handleUserStatsUpdated = useCallback(
    (payload: UserStatsUpdatedEvent) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.reputation.byUser(payload.userId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.user.reputation(payload.userId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.user.profile(payload.userId),
      });
    },
    [queryClient],
  );

  // Subscribe / unsubscribe whenever the connection state changes.
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribers = [
      subscribe('CLAIM_CREATED', handleClaimCreated),
      subscribe('CLAIM_UPDATED', handleClaimUpdated),
      subscribe('CLAIM_STATUS_CHANGED', handleClaimStatusChanged),
      subscribe('VERIFICATION_ADDED', handleVerificationAdded),
      subscribe('DISPUTE_CREATED', handleDisputeCreated),
      subscribe('DISPUTE_RESOLVED', handleDisputeResolved),
      subscribe('LEADERBOARD_UPDATED', handleLeaderboardUpdated),
      subscribe('USER_STATS_UPDATED', handleUserStatsUpdated),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub?.());
    };
  }, [
    isConnected,
    subscribe,
    handleClaimCreated,
    handleClaimUpdated,
    handleClaimStatusChanged,
    handleVerificationAdded,
    handleDisputeCreated,
    handleDisputeResolved,
    handleLeaderboardUpdated,
    handleUserStatsUpdated,
  ]);
}

/**
 * Lightweight hook that only subscribes to leaderboard stream updates.
 * Use this in components that only render the leaderboard.
 */
export function useRealtimeLeaderboard() {
  const { subscribe, isConnected } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribe('LEADERBOARD_UPDATED', (payload) => {
      queryClient.setQueryData(
        queryKeys.leaderboard,
        sortAndNormalizeLeaderboard(payload.rankings),
      );
    });

    return () => unsubscribe?.();
  }, [isConnected, subscribe, queryClient]);
}
