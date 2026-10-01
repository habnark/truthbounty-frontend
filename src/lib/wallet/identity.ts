/**
 * V2-FE-046 — Wallet identity invalidation.
 *
 * Pure, framework-free rules that decide what must happen when the connected
 * account or chain changes. The active provider remains authoritative; this
 * module only classifies the change and the required invalidation so the
 * React/Query layers can act deterministically.
 *
 * Security invariants:
 *  - Untrusted wallet input is normalised/validated (canonical EVM accounts only).
 *  - A submitted transaction with a real txHash keeps its canonical receipt;
 *    only unsigned local intents are discarded.
 *  - No fabricated address, chain, hash, or session state.
 */

import { isValidContractAddress } from '@/lib/contracts/address-guard';
import type { TransactionStatus } from '@/lib/transaction-machine/transaction-machine.types';

export interface WalletIdentity {
  /** Canonical EVM account, or null when disconnected/invalid. */
  readonly address: `0x${string}` | null;
  /** Chain id, or null when unknown. */
  readonly chainId: number | null;
}

/** Build a validated identity snapshot from raw provider values. */
export function normalizeWalletIdentity(
  address: string | null | undefined,
  chainId: number | null | undefined,
): WalletIdentity {
  return {
    address: isValidContractAddress(address) ? address : null,
    chainId:
      typeof chainId === 'number' && Number.isFinite(chainId) ? chainId : null,
  };
}

/** Stable, case-insensitive identity key used for change detection. */
export function walletIdentityKey(identity: WalletIdentity): string {
  if (!identity.address) return 'disconnected';
  return `${identity.address.toLowerCase()}:${identity.chainId ?? 'unknown'}`;
}

export function hasWalletIdentityChanged(
  previous: WalletIdentity,
  next: WalletIdentity,
): boolean {
  return walletIdentityKey(previous) !== walletIdentityKey(next);
}

// ---------------------------------------------------------------------------
// Transition classification
// ---------------------------------------------------------------------------

export type WalletIdentityTransition =
  | 'none'
  /** Disconnected → connected (fresh sign-in; no cache identity existed). */
  | 'connect'
  /** Connected → disconnected. */
  | 'disconnect'
  /** Connected account A → connected account B. */
  | 'account-change'
  /** Same account, different chain. */
  | 'chain-change';

/** Classify how the provider identity moved. Pure and total. */
export function classifyWalletIdentityTransition(
  previous: WalletIdentity,
  next: WalletIdentity,
): WalletIdentityTransition {
  const hadAccount = previous.address !== null;
  const hasAccount = next.address !== null;

  if (!hadAccount && !hasAccount) return 'none';
  if (!hadAccount && hasAccount) return 'connect';
  if (hadAccount && !hasAccount) return 'disconnect';

  // Both connected — compare account then chain.
  if (previous.address!.toLowerCase() !== next.address!.toLowerCase()) {
    return 'account-change';
  }
  if (previous.chainId !== next.chainId) return 'chain-change';
  return 'none';
}

/** Wallet-scoped caches must be dropped when the identity (or auth) changed. */
export function transitionClearsWalletCache(
  transition: WalletIdentityTransition,
): boolean {
  return (
    transition === 'disconnect' ||
    transition === 'account-change' ||
    transition === 'chain-change'
  );
}

/** Auth must be revalidated for every real provider change (not steady state). */
export function transitionRequiresAuthRevalidation(
  transition: WalletIdentityTransition,
): boolean {
  return transition !== 'none';
}

/** Account/chain changes require explicit user recovery before proceeding. */
export function transitionRequiresRecovery(
  transition: WalletIdentityTransition,
): boolean {
  return transition === 'account-change' || transition === 'chain-change';
}

// ---------------------------------------------------------------------------
// Wallet-scoped query detection
// ---------------------------------------------------------------------------

/**
 * Query keys whose cached data is only meaningful for the current account.
 * Global protocol reads (claims, disputes, leaderboard) are intentionally
 * retained and revalidated separately.
 */
export function isWalletScopedQueryKey(key: readonly unknown[]): boolean {
  if (!Array.isArray(key) || key.length === 0) return false;
  const [root, scope] = key;
  if (root === 'user') return true;
  if (root === 'verifications' && scope === 'user') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Transaction intent invalidation
// ---------------------------------------------------------------------------

export type TransactionIdentityInvalidation =
  | 'none'
  /** Unsigned local intent — safe to discard when identity changes. */
  | 'invalidate-intent'
  /** Submitted/confirming with a real hash — the canonical receipt wins. */
  | 'preserve-receipt';

const UNSIGNED_STATUSES = new Set<TransactionStatus>([
  'preparing',
  'signature-requested',
]);

const IN_FLIGHT_STATUSES = new Set<TransactionStatus>([
  'submitted',
  'confirming',
  'safe',
  'indexing',
]);

/**
 * Decide whether a transaction may be invalidated when the wallet identity
 * changes. A real on-chain hash is never discarded — only unsigned intents.
 */
export function classifyTransactionIdentityInvalidation(state: {
  readonly status: TransactionStatus;
  readonly txHash: `0x${string}` | null;
}): TransactionIdentityInvalidation {
  if (UNSIGNED_STATUSES.has(state.status)) return 'invalidate-intent';
  if (IN_FLIGHT_STATUSES.has(state.status) && state.txHash) return 'preserve-receipt';
  return 'none';
}
