'use client';

/**
 * V2-FE-046 — useWalletIdentityInvalidation
 *
 * Watches the active wallet identity and, on a real account/chain change,
 * deterministically invalidates incompatible state:
 *   1. cancels in-flight queries (and clears the mutation cache),
 *   2. removes wallet-scoped query caches,
 *   3. discards unsigned local transaction intents (real hashes are preserved),
 *   4. triggers auth revalidation, and
 *   5. requires explicit user recovery before proceeding.
 *
 * The provider is authoritative; the first settled identity is only seeded and
 * never treated as a change (so reload/reconnect does not wipe state).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useChainId } from 'wagmi';

import { useIsMounted } from '@/hooks/useIsMounted';
import {
  classifyTransactionIdentityInvalidation,
  classifyWalletIdentityTransition,
  isWalletScopedQueryKey,
  normalizeWalletIdentity,
  transitionClearsWalletCache,
  transitionRequiresAuthRevalidation,
  transitionRequiresRecovery,
  type WalletIdentity,
  type WalletIdentityTransition,
} from '@/lib/wallet/identity';
import {
  clearTxState,
  hydrateTxState,
  listPersistedTxIds,
} from '@/lib/transaction-machine/transaction-persistence';

export interface UseWalletIdentityInvalidationOptions {
  /** Called when auth must be revalidated (e.g. clear the SIWE session). */
  onRevalidateAuth?: (transition: WalletIdentityTransition) => void;
  /** Called when unsigned transaction intents were discarded. */
  onInvalidateTransaction?: (
    transition: WalletIdentityTransition,
    discarded: number,
  ) => void;
}

export interface UseWalletIdentityInvalidationReturn {
  /** True after an account/chain change until explicitly acknowledged. */
  requiresRecovery: boolean;
  /** Most recent transition observed (never a seed/hydration event). */
  lastTransition: WalletIdentityTransition;
  /** Acknowledge recovery and allow the UI to proceed. */
  acknowledge: () => void;
}

/**
 * Discard persisted transaction contexts that have no real on-chain hash.
 * Submitted/confirming transactions are preserved (receipt is authoritative).
 */
export function discardUnsignedTransactionIntents(): number {
  let discarded = 0;
  for (const id of listPersistedTxIds()) {
    const ctx = hydrateTxState(id);
    if (!ctx) continue;
    if (classifyTransactionIdentityInvalidation(ctx.state) === 'invalidate-intent') {
      clearTxState(id);
      discarded += 1;
    }
  }
  return discarded;
}

export function useWalletIdentityInvalidation(
  options: UseWalletIdentityInvalidationOptions = {},
): UseWalletIdentityInvalidationReturn {
  const mounted = useIsMounted();
  const { address, isConnecting, isReconnecting } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  const [lastTransition, setLastTransition] =
    useState<WalletIdentityTransition>('none');
  const [requiresRecovery, setRequiresRecovery] = useState(false);

  const seededRef = useRef(false);
  const previousRef = useRef<WalletIdentity>({ address: null, chainId: null });

  const onRevalidateAuthRef = useRef(options.onRevalidateAuth);
  const onInvalidateTransactionRef = useRef(options.onInvalidateTransaction);
  useEffect(() => {
    onRevalidateAuthRef.current = options.onRevalidateAuth;
    onInvalidateTransactionRef.current = options.onInvalidateTransaction;
  }, [options.onRevalidateAuth, options.onInvalidateTransaction]);

  const settled = mounted && !isConnecting && !isReconnecting;
  const identity = useMemo(
    () => normalizeWalletIdentity(address, chainId),
    [address, chainId],
  );

  useEffect(() => {
    if (!settled) return;

    // Seed the first settled identity without treating it as a change.
    if (!seededRef.current) {
      seededRef.current = true;
      previousRef.current = identity;
      return;
    }

    const transition = classifyWalletIdentityTransition(previousRef.current, identity);
    if (transition === 'none') return;
    previousRef.current = identity;

    if (transitionClearsWalletCache(transition)) {
      queryClient.cancelQueries();
      queryClient.getMutationCache().clear();
      queryClient.removeQueries({
        predicate: (query) => isWalletScopedQueryKey(query.queryKey),
      });
    }

    if (transitionRequiresAuthRevalidation(transition)) {
      onRevalidateAuthRef.current?.(transition);
    }

    const discarded = discardUnsignedTransactionIntents();
    if (discarded > 0) {
      onInvalidateTransactionRef.current?.(transition, discarded);
    }

    if (transitionRequiresRecovery(transition)) {
      setRequiresRecovery(true);
    }

    setLastTransition(transition);
  }, [settled, identity, queryClient]);

  const acknowledge = useCallback(() => setRequiresRecovery(false), []);

  return { requiresRecovery, lastTransition, acknowledge };
}
