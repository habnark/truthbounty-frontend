/**
 * V2-FE-009 — Shared Transaction State Machine
 * Core type definitions for the canonical Optimism/EVM transaction lifecycle.
 *
 * States (11):
 *   idle → preparing → signature-requested → submitted → confirming
 *        → safe → finalized
 *        → replaced | dropped | reverted | indexing
 *
 * Security invariants:
 *  - txHash is NEVER fabricated; it is null until Wagmi returns a real value
 *  - chainId is validated against ALLOWED_CHAIN_IDS before any transition past idle
 *  - Contradiction guard: illegal transitions throw TransactionMachineError
 *  - No non-EVM runtime dependencies
 */

// ---------------------------------------------------------------------------
// Chain configuration
// ---------------------------------------------------------------------------

/** Optimism Mainnet (10) and OP Sepolia testnet (11155420).
 *  Local Hardhat fork (31337) is permitted in non-production builds only.
 */
export const OPTIMISM_CHAIN_IDS = [10, 11155420] as const;

/** In test / local-dev environments the local Hardhat fork is also allowed. */
export const ALLOWED_CHAIN_IDS_DEV = [
  ...OPTIMISM_CHAIN_IDS,
  31337, // Hardhat local fork
] as const;

export type OptimismChainId = (typeof OPTIMISM_CHAIN_IDS)[number];

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type TransactionMachineErrorReason =
  | "USER_REJECTED"
  | "WRONG_NETWORK"
  | "REVERT"
  | "DROPPED"
  | "REPLACED"
  | "STALE_RECEIPT" // receipt chainId does not match expected
  | "INVALID_TRANSITION"
  | "INVALID_PERSISTED_STATE";

export class TransactionMachineError extends Error {
  readonly reason: TransactionMachineErrorReason;

  constructor(reason: TransactionMachineErrorReason, detail?: string) {
    super(`[TransactionMachine] ${reason}${detail ? `: ${detail}` : ""}`);
    this.name = "TransactionMachineError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// State definitions — discriminated union on `status`
// ---------------------------------------------------------------------------

/** Nothing is happening; wallet may or may not be connected. */
export interface TxStateIdle {
  readonly status: "idle";
  readonly txHash: null;
  readonly chainId: number | null;
  readonly blockNumber: null;
  readonly confirmations: null;
  readonly error: null;
  readonly replacedBy: null;
}

/** Building the transaction payload; chain/address validation in progress. */
export interface TxStatePreparing {
  readonly status: "preparing";
  readonly txHash: null;
  readonly chainId: number;
  readonly blockNumber: null;
  readonly confirmations: null;
  readonly error: null;
  readonly replacedBy: null;
}

/** Wallet popup is open; waiting for user's signature. */
export interface TxStateSignatureRequested {
  readonly status: "signature-requested";
  readonly txHash: null;
  readonly chainId: number;
  readonly blockNumber: null;
  readonly confirmations: null;
  readonly error: null;
  readonly replacedBy: null;
}

/** Transaction has been broadcast to the network; mempool-pending. */
export interface TxStateSubmitted {
  readonly status: "submitted";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: null;
  readonly confirmations: null;
  readonly error: null;
  readonly replacedBy: null;
}

/** Transaction is included in a block; waiting for sufficient confirmations. */
export interface TxStateConfirming {
  readonly status: "confirming";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly confirmations: number;
  readonly error: null;
  readonly replacedBy: null;
}

/**
 * Enough L2 confirmations received (≥ 1 on Optimism); safe to act on.
 * Not yet L1-finalized.
 */
export interface TxStateSafe {
  readonly status: "safe";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly confirmations: number;
  readonly error: null;
  readonly replacedBy: null;
}

/**
 * The TruthBounty indexer has acknowledged the transaction and the
 * on-chain projection is reflected in backend state.
 */
export interface TxStateIndexing {
  readonly status: "indexing";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly confirmations: number;
  readonly error: null;
  readonly replacedBy: null;
}

/**
 * L1-finalized and fully indexed. Terminal success state.
 * Persisted state is cleared after this is acknowledged.
 */
export interface TxStateFinalized {
  readonly status: "finalized";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly confirmations: number;
  readonly error: null;
  readonly replacedBy: null;
}

/**
 * Transaction was dropped from the mempool (e.g. gas too low, timeout).
 * Terminal; user may retry from idle.
 */
export interface TxStateDropped {
  readonly status: "dropped";
  readonly txHash: `0x${string}` | null;
  readonly chainId: number;
  readonly blockNumber: null;
  readonly confirmations: null;
  readonly error: TransactionMachineErrorReason;
  readonly replacedBy: null;
}

/**
 * The original transaction was replaced by a different transaction
 * (same nonce, different hash). Terminal.
 */
export interface TxStateReplaced {
  readonly status: "replaced";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: null;
  readonly confirmations: null;
  readonly error: null;
  /** Hash of the transaction that replaced this one. */
  readonly replacedBy: `0x${string}`;
}

/**
 * Transaction was included but the EVM reverted it (status 0x0).
 * Terminal; user may retry from idle.
 */
export interface TxStateReverted {
  readonly status: "reverted";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly confirmations: null;
  readonly error: "REVERT";
  readonly replacedBy: null;
}

/**
 * A previously confirmed/safe transaction was reorged out of the canonical chain.
 * Terminal failure state; user may retry from idle once the new canonical state
 * has been reconciled against the indexer/API.
 */
export interface TxStateReorged {
  readonly status: "reorged";
  readonly txHash: `0x${string}`;
  readonly chainId: number;
  readonly blockNumber: bigint | null;
  readonly confirmations: null;
  readonly error: "REORG";
  readonly replacedBy: null;
}

/** Discriminated union of all 12 transaction states. */
export type TransactionState =
  | TxStateIdle
  | TxStatePreparing
  | TxStateSignatureRequested
  | TxStateSubmitted
  | TxStateConfirming
  | TxStateSafe
  | TxStateIndexing
  | TxStateFinalized
  | TxStateDropped
  | TxStateReplaced
  | TxStateReverted
  | TxStateReorged;

export type TransactionStatus = TransactionState["status"];

// ---------------------------------------------------------------------------
// Event definitions — discriminated union on `type`
// ---------------------------------------------------------------------------

/** Begin building a transaction on the specified chain. */
export interface TxEventPrepare {
  readonly type: "PREPARE";
  readonly chainId: number;
}

/** Wallet popup has opened; signature is pending. */
export interface TxEventRequestSignature {
  readonly type: "REQUEST_SIGNATURE";
}

/** User rejected the signature request in their wallet. */
export interface TxEventUserRejected {
  readonly type: "USER_REJECTED";
}

/** Transaction broadcast successfully; mempool hash received. */
export interface TxEventSubmit {
  readonly type: "SUBMIT";
  readonly txHash: `0x${string}`;
}

/** Transaction included in a block; receipt received. */
export interface TxEventConfirm {
  readonly type: "CONFIRM";
  readonly blockNumber: bigint;
  readonly confirmations: number;
  /** chainId from the receipt — validated against expected before transition. */
  readonly receiptChainId: number;
}

/** Sufficient confirmations have accumulated; mark as safe. */
export interface TxEventMarkSafe {
  readonly type: "MARK_SAFE";
}

/** Indexer has begun processing; waiting for backend acknowledgement. */
export interface TxEventIndexing {
  readonly type: "INDEXING";
}

/** Indexer has confirmed; transaction is fully finalized. */
export interface TxEventFinalize {
  readonly type: "FINALIZE";
}

/** Transaction was dropped from the mempool. */
export interface TxEventDrop {
  readonly type: "DROP";
}

/**
 * Transaction was replaced by a different one (speedup / cancellation).
 * The caller must provide the replacement hash.
 */
export interface TxEventReplace {
  readonly type: "REPLACE";
  readonly replacedBy: `0x${string}`;
}

/** EVM execution reverted. */
export interface TxEventRevert {
  readonly type: "REVERT";
}

/** Previously confirmed transaction was reorged out of the canonical chain. */
export interface TxEventReorg {
  readonly type: "REORG";
}

/** Reset a terminal failure state (dropped, reverted) back to idle for retry. */
export interface TxEventRetry {
  readonly type: "RETRY";
}

/** Unconditional reset — always returns to idle. Used for cleanup. */
export interface TxEventReset {
  readonly type: "RESET";
}

/** Discriminated union of all legal machine events. */
export type TransactionEvent =
  | TxEventPrepare
  | TxEventRequestSignature
  | TxEventUserRejected
  | TxEventSubmit
  | TxEventConfirm
  | TxEventMarkSafe
  | TxEventIndexing
  | TxEventFinalize
  | TxEventDrop
  | TxEventReplace
  | TxEventRevert
  | TxEventReorg
  | TxEventRetry
  | TxEventReset;

export type TransactionEventType = TransactionEvent["type"];

// ---------------------------------------------------------------------------
// Persistence context
// ---------------------------------------------------------------------------

/**
 * Serializable snapshot written to localStorage for reload recovery.
 * Schema version is included so stale records can be discarded safely.
 */
export interface TransactionContext {
  /** Opaque caller-assigned identifier (e.g. `rewards:claim-1`). */
  readonly id: string;
  /** Storage schema version. Increment when shape changes. */
  readonly schemaVersion: 2;
  readonly state: TransactionState;
  /** Human-readable label for display in pending transaction lists. */
  readonly label: string;
  /** Unix timestamp (ms) when this entry was first created. */
  readonly createdAt: number;
  /** Unix timestamp (ms) of the last state update. */
  readonly updatedAt: number;
}

// ---------------------------------------------------------------------------
// Guard helpers (pure, no side-effects)
// ---------------------------------------------------------------------------

/** Terminal success states — persisted state is cleared after acknowledgement. */
const TERMINAL_SUCCESS = new Set<TransactionStatus>(["finalized"]);

/** Terminal failure states — user may retry. */
const TERMINAL_FAILURE = new Set<TransactionStatus>([
  "dropped",
  "replaced",
  "reverted",
  "reorged",
]);

export function isTerminalSuccess(s: TransactionStatus): boolean {
  return TERMINAL_SUCCESS.has(s);
}

export function isTerminalFailure(s: TransactionStatus): boolean {
  return TERMINAL_FAILURE.has(s);
}

export function isTerminal(s: TransactionStatus): boolean {
  return isTerminalSuccess(s) || isTerminalFailure(s);
}

/**
 * Guard: returns true if the combination of `from` → `to` is a known
 * contradiction (e.g. reverted → safe, idle → finalized).
 * Used as an extra safety net after the reducer's exhaustive switch.
 */
export function isContradictoryTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  if (from === "reverted" && to === "safe") return true;
  if (from === "reverted" && to === "finalized") return true;
  if (from === "dropped" && to === "safe") return true;
  if (from === "dropped" && to === "finalized") return true;
  if (from === "reorged" && (to === "safe" || to === "finalized")) return true;
  if (from === "idle" && to === "finalized") return true;
  if (from === "idle" && to === "safe") return true;
  return false;
}

/**
 * Guard: validates that `chainId` is in the set of permitted chains.
 * In production only OP Mainnet and OP Sepolia are allowed.
 * In test / local-dev Hardhat fork (31337) is also accepted.
 */
export function isValidChain(chainId: number, allowLocalDev = false): boolean {
  const allowed = allowLocalDev ? ALLOWED_CHAIN_IDS_DEV : OPTIMISM_CHAIN_IDS;
  return (allowed as readonly number[]).includes(chainId);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Parameters for the canonical claim creation call. */
export interface ClaimCreationParams {
  /** 32-byte content digest of the evidence (e.g. keccak256 of content). */
  readonly contentDigest: `0x${string}`;
  /** ERC-20 token address used for the bounty. */
  readonly bountyAsset: `0x${string}`;
  /** Exact integer amount of the bounty asset to claim. */
  readonly bountyAmount: bigint;
  /** ABI-encoded frozen configuration expected by the bounty contract. */
  readonly frozenConfig: `0x${string}`;
}

/** Protocol-level errors surfaced by claim creation. */
export type ClaimCreationErrorReason =
  | "INVALID_CONTENT_DIGEST"
  | "INVALID_BOUNTY_ASSET"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_ALLOWANCE"
  | "SIMULATION_REVERTED"
  | "CLAIM_ALREADY_EXISTS"
  | "CLAIM_NOT_ELIGIBLE"
  | "CLAIM_WINDOW_CLOSED";

/** Fully-validated request used to drive allowance/simulation/submission. */
export interface ClaimCreationRequest {
  readonly params: ClaimCreationParams;
  readonly chainId: number;
  readonly account: `0x${string}`;
  readonly contractAddress: `0x${string}`;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Return the canonical idle state. */
export function createIdleState(): TxStateIdle {
  return {
    status: "idle",
    txHash: null,
    chainId: null,
    blockNumber: null,
    confirmations: null,
    error: null,
    replacedBy: null,
  };
}
