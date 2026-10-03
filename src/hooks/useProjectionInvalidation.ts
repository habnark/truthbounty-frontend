/**
 * useProjectionInvalidation
 *
 * Targeted cache invalidation after a transaction is confirmed on-chain.
 * Only the projection namespaces that could be affected by the given
 * transaction type are invalidated — no cache-wide churn.
 *
 * Security rules:
 *  - Never fabricate a txHash or confirmation count.
 *  - Only invalidate keys that are logically downstream of the confirmed tx.
 *  - Finality level must come from an actual on-chain receipt; never assume.
 */

'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/queries/queryKeys';
import type { FinalityLevel } from '@/app/types/finality';

/**
 * The category of action whose receipt just confirmed.
 * Add new variants here when new protocol actions are introduced.
 */
export type ConfirmedActionKind =
  | 'claim_submitted'
  | 'verification_submitted'
  | 'dispute_created'
  | 'dispute_resolved'
  | 'rewards_claimed'
  | 'settlement_executed'
  | 'finalization_executed';

export interface ConfirmedTxContext {
  kind: ConfirmedActionKind;
  /** The transaction hash that was confirmed. Must come from an actual receipt. */
  txHash: `0x${string}`;
  /** Chain ID from the receipt — validated against the expected network. */
  chainId: number;
  /** IDs of on-chain entities affected by this transaction. */
  claimId?: string;
  disputeId?: string;
  /** Wallet address that submitted the transaction. */
  fromAddress?: string;
  /** The finality level at which this invalidation is triggered. */
  finalityLevel: FinalityLevel;
}

/**
 * Returns an `invalidate` callback that performs projection-aware cache
 * invalidation whenever a transaction is confirmed.
 *
 * Callers should invoke `invalidate(ctx)` after receiving an on-chain
 * receipt (e.g. from `useWaitForTransactionReceipt`) and verifying that
 * the chain ID matches the expected network.
 *
 * Reorged transactions (`finalityLevel === 'reorged'`) invalidate the
 * finality projection cache entries so the UI can re-derive state from
 * fresh on-chain data.
 */
export function useProjectionInvalidation() {
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    (ctx: ConfirmedTxContext) => {
      const { kind, claimId, disputeId, fromAddress, finalityLevel } = ctx;

      // If the transaction was reorged, only bust the finality projections.
      if (finalityLevel === 'reorged') {
        if (claimId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.claims.finality(claimId),
          });
        }
        if (disputeId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.disputes.finality(disputeId),
          });
        }
        return;
      }

      // For all non-reorged confirmations, selectively bust the relevant
      // projection namespaces based on the action kind.
      switch (kind) {
        case 'claim_submitted': {
          // A new claim is now on-chain: invalidate the list caches.
          queryClient.invalidateQueries({ queryKey: queryKeys.claims.lists() });
          break;
        }

        case 'verification_submitted': {
          if (claimId) {
            // The claim detail (verification count, confidence) changed.
            queryClient.invalidateQueries({
              queryKey: queryKeys.claims.detail(claimId),
            });
            // The verification list for this claim may have a new entry.
            queryClient.invalidateQueries({
              queryKey: queryKeys.verifications.byClaim(claimId),
            });
          }
          if (fromAddress) {
            // The verifier's reputation projection may have changed.
            queryClient.invalidateQueries({
              queryKey: queryKeys.reputation.byUser(fromAddress),
            });
          }
          break;
        }

        case 'dispute_created': {
          if (claimId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.claims.detail(claimId),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.disputes.byClaim(claimId),
            });
          }
          break;
        }

        case 'dispute_resolved': {
          if (claimId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.claims.detail(claimId),
            });
          }
          if (disputeId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.disputes.detail(disputeId),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.disputes.finality(disputeId),
            });
          }
          // Reward projections may be affected by the dispute outcome.
          queryClient.invalidateQueries({ queryKey: queryKeys.rewards.all });
          break;
        }

        case 'rewards_claimed': {
          if (fromAddress) {
            // Only invalidate rewards for the wallet that claimed.
            queryClient.invalidateQueries({
              queryKey: queryKeys.rewards.claimable(fromAddress),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.rewards.history(fromAddress),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.wallet.balance(fromAddress, ctx.chainId),
            });
          }
          break;
        }

        case 'settlement_executed': {
          if (claimId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.claims.detail(claimId),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.rounds.byClaim(claimId),
            });
          }
          break;
        }

        case 'finalization_executed': {
          if (claimId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.claims.detail(claimId),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.claims.finality(claimId),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.rounds.byClaim(claimId),
            });
          }
          // After finalization, reward projections update for all participants.
          queryClient.invalidateQueries({ queryKey: queryKeys.rewards.all });
          break;
        }
      }
    },
    [queryClient],
  );

  return { invalidate };
}
