// src/hooks/useRealtimeClaims.ts

'use client';

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/components/providers/WebSocketProvider';
import { queryKeys } from '@/app/queries/queryKeys';
import type {
  ClaimStatus,
} from '@/app/types/claim';

/**
 * Hook for real-time claim updates
 * Automatically updates local state when WebSocket events arrive
 */
export function useRealtimeClaim(claimId: string) {
  const { subscribe, isConnected, send } = useWebSocketContext();
  const queryClient = useQueryClient();

  // Subscribe to claim updates
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribe('CLAIM_STATUS_CHANGED', (payload) => {
      if (payload.claimId === claimId) {
        // Invalidate the claim query to trigger a refetch
        queryClient.invalidateQueries({
          queryKey: queryKeys.claims.detail(claimId),
        });
      }
    });

    return unsubscribe;
  }, [isConnected, subscribe, queryClient, claimId]);

  // Subscribe to verification updates for this claim
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribe('VERIFICATION_ADDED', (payload) => {
      if (payload.claimId === claimId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.verifications.byClaim(claimId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.claims.detail(claimId),
        });
      }
    });

    return unsubscribe;
  }, [isConnected, subscribe, queryClient, claimId]);

  // Subscribe to dispute updates for this claim
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribeStatus = subscribe('CLAIM_STATUS_CHANGED', (payload) => {
      if (payload.claimId === claimId && payload.newStatus === 'DISPUTED') {
        queryClient.invalidateQueries({
          queryKey: queryKeys.disputes.byClaim(claimId),
        });
      }
    });

    const unsubscribeDispute = subscribe('DISPUTE_RESOLVED', (payload) => {
      if (payload.claimId === claimId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.claims.detail(claimId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.disputes.byClaim(claimId),
        });
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeDispute();
    };
  }, [isConnected, subscribe, queryClient, claimId]);

  // Function to manually request updates
  const requestUpdate = useCallback(() => {
    send({
      type: 'REQUEST_CLAIM_UPDATE',
      payload: { claimId },
    });
  }, [send, claimId]);

  return {
    isConnected,
    requestUpdate,
  };
}

/**
 * Hook for real-time claims list updates
 */
export function useRealtimeClaimsList() {
  const { subscribe, isConnected } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribe('CLAIM_CREATED', () => {
      // New claim created - invalidate list
      queryClient.invalidateQueries({
        queryKey: queryKeys.claims.lists(),
      });
    });

    return unsubscribe;
  }, [isConnected, subscribe, queryClient]);

  return { isConnected };
}

/**
 * Hook to get optimistic updates for claim status changes
 * This can be used to show immediate feedback while waiting for server confirmation
 */
export function useOptimisticClaimUpdate(claimId: string) {
  const queryClient = useQueryClient();

  const optimisticUpdate = useCallback(
    (newStatus: ClaimStatus) => {
      // Optimistically update the claim status in cache
      queryClient.setQueryData(queryKeys.claims.detail(claimId), (old: unknown) => {
        if (old && typeof old === 'object') {
          return { ...old, status: newStatus };
        }
        return old;
      });
    },
    [queryClient, claimId]
  );

  const rollback = useCallback(() => {
    // Invalidate to get actual data
    queryClient.invalidateQueries({
      queryKey: queryKeys.claims.detail(claimId),
    });
  }, [queryClient, claimId]);

  return { optimisticUpdate, rollback };
}
