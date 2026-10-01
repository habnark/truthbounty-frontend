/**
 * useFinalityLevel
 *
 * Derives and stores the finality level (observed | safe | finalized | reorged)
 * for a transaction from on-chain block data.
 *
 * The result is written into the query cache under the appropriate
 * `claims.finality` or `disputes.finality` key so that:
 *  1. Multiple components can subscribe without redundant RPC calls.
 *  2. Projection-aware invalidation (useProjectionInvalidation) can bust
 *     stale entries when the chain state changes.
 *
 * Security rules:
 *  - Block numbers and receipt data must come from the on-chain RPC; never
 *    accept them from untrusted user input or local state.
 *  - Chain ID must match the expected network before deriving finality.
 */

'use client';

import { usePublicClient } from 'wagmi';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/queries/queryKeys';
import {
  deriveFinalityLevel,
  type FinalityContext,
  type FinalityResult,
  type FinalityCacheEntry,
} from '@/app/types/finality';

interface UseFinalityLevelOptions {
  /** Transaction hash — must come from a confirmed receipt. */
  txHash?: `0x${string}`;
  /** Chain ID to validate against. */
  expectedChainId: number;
  /** If provided, result is also stored under `claims.finality(claimId)`. */
  claimId?: string;
  /** If provided, result is also stored under `disputes.finality(disputeId)`. */
  disputeId?: string;
  /**
   * How often to re-evaluate finality (ms).
   * Defaults to 12 000 ms (≈ 1 L2 block on Optimism).
   */
  pollInterval?: number;
}

interface UseFinalityLevelReturn {
  level: FinalityResult['level'] | null;
  depth: number | null;
  isFinalized: boolean;
  isSafe: boolean;
  isReorged: boolean;
  isLoading: boolean;
  error: Error | null;
}

/** Internal query key for the finality check of a single tx hash. */
const txFinalityQueryKey = (txHash: string, chainId: number) =>
  ['tx-finality', txHash, chainId] as const;

export function useFinalityLevel(
  options: UseFinalityLevelOptions,
): UseFinalityLevelReturn {
  const {
    txHash,
    expectedChainId,
    claimId,
    disputeId,
    pollInterval = 12_000,
  } = options;

  const publicClient = usePublicClient({ chainId: expectedChainId });
  const queryClient = useQueryClient();

  const {
    data: result,
    isLoading,
    error,
  } = useQuery<FinalityResult | null>({
    queryKey: txHash ? txFinalityQueryKey(txHash, expectedChainId) : ['tx-finality-disabled'],
    queryFn: async (): Promise<FinalityResult | null> => {
      if (!txHash || !publicClient) return null;

      const previousResult = queryClient.getQueryData<FinalityResult>(
        txFinalityQueryKey(txHash, expectedChainId),
      );

      // Fetch the receipt and current head block numbers in parallel.
      // getBlockNumber() gives `latest`; getBlock() with blockTag gives safe/finalized.
      // Safe and finalized block tags may not be supported by all providers —
      // failures are caught and treated as "unknown".
      let receipt;
      try {
        receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      } catch (receiptError) {
        if (!previousResult) throw receiptError;
        receipt = null;
      }

      const [latestBlock, safeBlockResult, finalizedBlockResult] =
        await Promise.all([
          publicClient.getBlockNumber(),
          publicClient
            .getBlock({ blockTag: 'safe' })
            .catch(() => undefined),
          publicClient
            .getBlock({ blockTag: 'finalized' })
            .catch(() => undefined),
        ]);

      const safeBlock = safeBlockResult?.number;
      const finalizedBlock = finalizedBlockResult?.number;

      if (!receipt && !previousResult) return null;

      // Validate chain: the publicClient is already scoped to `expectedChainId`
      // via `usePublicClient({ chainId: expectedChainId })`.  We additionally
      // verify the client's chain matches what the caller declared so that any
      // wagmi mis-wiring is caught at the finality layer rather than silently
      // producing wrong results.
      const clientChainId = publicClient.chain?.id;
      if (clientChainId !== undefined && clientChainId !== expectedChainId) {
        throw new Error(
          `Chain mismatch: public client is on chain ${clientChainId}, expected ${expectedChainId}`,
        );
      }

      const previousObservation = previousResult
        ? {
            blockNumber: previousResult.context.blockNumber,
            blockHash: previousResult.context.blockHash,
          }
        : undefined;

      if (!receipt) {
        const previousContext = previousResult!.context;
        return deriveFinalityLevel({
          ...previousContext,
          headBlockNumbers: {
            latest: latestBlock,
            safe: safeBlock,
            finalized: finalizedBlock,
          },
          previousObservation,
          blockHash: undefined,
          receiptPresent: false,
        });
      }

      const canonicalBlock = await Promise.resolve(
        publicClient.getBlock({ blockNumber: receipt.blockNumber }),
      ).catch(() => undefined);
      const blockHash = canonicalBlock?.hash ?? receipt.blockHash;

      const ctx: FinalityContext = {
        txHash,
        chainId: expectedChainId,
        blockNumber: receipt.blockNumber,
        receiptStatus: receipt.status === 'success' ? '0x1' : '0x0',
        blockHash,
        receiptPresent: true,
        previousObservation,
        headBlockNumbers: {
          latest: latestBlock,
          safe: safeBlock,
          finalized: finalizedBlock,
        },
      };

      const finalityResult = deriveFinalityLevel(ctx);

      // Write into entity-scoped cache entries so downstream components and
      // invalidation hooks can read and bust them independently.
      const entry: FinalityCacheEntry = {
        txHash,
        chainId: expectedChainId,
        level: finalityResult.level,
        blockNumber: receipt.blockNumber,
        depth: finalityResult.depth,
        updatedAt: new Date().toISOString(),
      };

      if (claimId) {
        queryClient.setQueryData(queryKeys.claims.finality(claimId), entry);
      }
      if (disputeId) {
        queryClient.setQueryData(queryKeys.disputes.finality(disputeId), entry);
      }

      return finalityResult;
    },
    enabled: !!txHash && !!publicClient,
    refetchInterval: pollInterval,
    // Never treat finality data as fresh for longer than one poll interval.
    staleTime: pollInterval,
  });

  if (!txHash || !result) {
    return {
      level: null,
      depth: null,
      isFinalized: false,
      isSafe: false,
      isReorged: false,
      isLoading: !!txHash && isLoading,
      error: error as Error | null,
    };
  }

  return {
    level: result.level,
    depth: result.depth,
    isFinalized: result.isFinalized,
    isSafe: result.isSafe,
    isReorged: result.isReorged,
    isLoading,
    error: error as Error | null,
  };
}

/**
 * Read the cached finality entry for a claim without triggering a
 * new RPC call.  Returns `null` when no entry is present.
 */
export function useClaimFinalityCache(claimId: string): FinalityCacheEntry | null {
  const queryClient = useQueryClient();
  return queryClient.getQueryData<FinalityCacheEntry>(
    queryKeys.claims.finality(claimId),
  ) ?? null;
}

/**
 * Read the cached finality entry for a dispute without triggering a
 * new RPC call.  Returns `null` when no entry is present.
 */
export function useDisputeFinalityCache(disputeId: string): FinalityCacheEntry | null {
  const queryClient = useQueryClient();
  return queryClient.getQueryData<FinalityCacheEntry>(
    queryKeys.disputes.finality(disputeId),
  ) ?? null;
}
