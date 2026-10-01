/**
 * Finality state types for TruthBounty V2
 *
 * Represents the four distinct finality levels recognised by Optimism/EVM:
 *
 *  observed  — tx was seen in the mempool or a pending block; not yet included
 *  safe      — tx is in a sequencer-confirmed L2 block (OP "safe" head)
 *  finalized — tx is in an L1-anchored, irreversible batch (OP "finalized" head)
 *  reorged   — a previously observed tx was invalidated by a chain reorganisation
 *
 * None of these levels may be fabricated from mock or local state alone;
 * the authoritative source is always the on-chain receipt and block tag.
 */

// ---------------------------------------------------------------------------
// Core finality discriminant
// ---------------------------------------------------------------------------

/** Ordered by increasing confirmation strength. */
export type FinalityLevel = 'observed' | 'safe' | 'finalized' | 'reorged';

/**
 * Minimum on-chain data needed to derive a finality level for a transaction.
 * All fields that come from the chain must not be fabricated by the UI.
 */
export interface FinalityContext {
  /** Transaction hash — must match the emitted receipt. */
  txHash: `0x${string}`;
  /** Chain ID on which the tx was submitted. */
  chainId: number;
  /** Block in which the tx was included, expressed as a bigint (wei-aligned). */
  blockNumber: bigint;
  /** Receipt status as returned by `eth_getTransactionReceipt`. */
  receiptStatus: '0x1' | '0x0';
  /** Hash of the canonical block containing the current receipt. */
  blockHash?: `0x${string}`;
  /** Whether the current poll found a canonical receipt. Defaults to true. */
  receiptPresent?: boolean;
  /** Receipt observation from an earlier poll, used to identify reorgs. */
  previousObservation?: {
    blockNumber: bigint;
    blockHash?: `0x${string}`;
  };
  /**
   * Latest block numbers reported by the node.
   * At minimum `latest` must be present.  `safe` and `finalized` are optional
   * because some RPC providers do not surface them.
   */
  headBlockNumbers: {
    latest: bigint;
    safe?: bigint;
    finalized?: bigint;
  };
}

// ---------------------------------------------------------------------------
// Derived finality result
// ---------------------------------------------------------------------------

export interface FinalityResult {
  /** The resolved finality level. */
  level: FinalityLevel;
  /**
   * Number of blocks between the tx block and the relevant head.
  * For `reorged`, this is the negative number of blocks since the previously
  * observed transaction block (at least -1 when a receipt disappears).
   */
  depth: number;
  /** True when `level` is `finalized`. */
  isFinalized: boolean;
  /** True when `level` is `reorged`. */
  isReorged: boolean;
  /** True when `level` is `safe` OR `finalized`. */
  isSafe: boolean;
  /** True when `level` is any of the four (i.e. we have a result at all). */
  isResolved: boolean;
  /** Snapshot of the context that produced this result. */
  context: FinalityContext;
}

/**
 * Derive a finality result from a given context.
 *
 * Rules (Optimism semantics):
 *  - If the canonical receipt disappeared or its block changed since the
 *    previous observation → `reorged`
 *  - If `receiptStatus === '0x0'`               → result is still tracked but
 *    the tx *reverted*; level uses normal rules, callers must check receiptStatus separately.
 *  - If `finalized` head is known and `blockNumber <= finalized` → `finalized`
 *  - If `safe` head is known and `blockNumber <= safe`          → `safe`
 *  - Otherwise                                                   → `observed`
 */
export function deriveFinalityLevel(ctx: FinalityContext): FinalityResult {
  const { blockNumber, headBlockNumbers, previousObservation } = ctx;
  const { latest, safe, finalized } = headBlockNumbers;

  const receiptChanged = previousObservation && (
    ctx.receiptPresent === false ||
    previousObservation.blockNumber !== blockNumber ||
    (previousObservation.blockHash !== undefined &&
      ctx.blockHash !== undefined &&
      previousObservation.blockHash !== ctx.blockHash)
  );

  if (receiptChanged) {
    return buildResult(
      'reorged',
      ctx,
      -Math.max(1, Number(latest - previousObservation.blockNumber)),
    );
  }

  if (finalized !== undefined && blockNumber <= finalized) {
    return buildResult('finalized', ctx, Number(finalized - blockNumber));
  }

  if (safe !== undefined && blockNumber <= safe) {
    return buildResult('safe', ctx, Number(safe - blockNumber));
  }

  return buildResult('observed', ctx, Number(latest - blockNumber));
}

function buildResult(
  level: FinalityLevel,
  context: FinalityContext,
  depth: number,
): FinalityResult {
  return {
    level,
    depth,
    isFinalized: level === 'finalized',
    isReorged: level === 'reorged',
    isSafe: level === 'safe' || level === 'finalized',
    isResolved: true,
    context,
  };
}

// ---------------------------------------------------------------------------
// Projection-aware finality record stored in the query cache
// ---------------------------------------------------------------------------

/**
 * Shape stored under `queryKeys.claims.finality(claimId)` and
 * `queryKeys.disputes.finality(disputeId)`.
 */
export interface FinalityCacheEntry {
  txHash: `0x${string}`;
  chainId: number;
  level: FinalityLevel;
  blockNumber: bigint;
  depth: number;
  /** ISO-8601 timestamp of when this entry was last refreshed from the chain. */
  updatedAt: string;
}
