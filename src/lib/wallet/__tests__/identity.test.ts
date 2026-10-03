/**
 * V2-FE-046 — Wallet identity invalidation (pure unit tests).
 *
 * Proves the transition classification and invalidation rules are
 * deterministic and fail closed, and that only unsigned transaction intents
 * are ever discarded.
 */

import {
  classifyTransactionIdentityInvalidation,
  classifyWalletIdentityTransition,
  hasWalletIdentityChanged,
  isWalletScopedQueryKey,
  normalizeWalletIdentity,
  transitionClearsWalletCache,
  transitionRequiresAuthRevalidation,
  transitionRequiresRecovery,
  walletIdentityKey,
  type WalletIdentity,
} from '../identity';

const ADDR_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const ADDR_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const ZERO = '0x0000000000000000000000000000000000000000';

const id = (
  address?: string | null,
  chainId?: number | null,
): WalletIdentity => normalizeWalletIdentity(address, chainId);

describe('normalizeWalletIdentity', () => {
  it('accepts canonical accounts and finite chain ids', () => {
    expect(id(ADDR_A, 10)).toEqual({ address: ADDR_A, chainId: 10 });
  });

  it('rejects malformed, zero, placeholder and Stellar addresses', () => {
    expect(id('0x123', 10).address).toBeNull();
    expect(id(ZERO, 10).address).toBeNull();
    expect(id('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW', 10).address).toBeNull();
    expect(id(undefined, 10).address).toBeNull();
  });

  it('rejects non-finite chain ids', () => {
    expect(id(ADDR_A, NaN).chainId).toBeNull();
    expect(id(ADDR_A, undefined).chainId).toBeNull();
  });
});

describe('walletIdentityKey', () => {
  it('is case-insensitive and marks disconnected', () => {
    const upperA = `${ADDR_A.slice(0, 2)}${ADDR_A.slice(2).toUpperCase()}`;
    expect(walletIdentityKey(id(ADDR_A, 10))).toBe(
      `${ADDR_A.toLowerCase()}:10`,
    );
    expect(walletIdentityKey(id(upperA, 10))).toBe(
      `${ADDR_A.toLowerCase()}:10`,
    );
    expect(walletIdentityKey(id(null, null))).toBe('disconnected');
  });
});

describe('hasWalletIdentityChanged', () => {
  it('detects account and chain changes', () => {
    expect(hasWalletIdentityChanged(id(ADDR_A, 10), id(ADDR_A, 10))).toBe(false);
    expect(hasWalletIdentityChanged(id(ADDR_A, 10), id(ADDR_B, 10))).toBe(true);
    expect(hasWalletIdentityChanged(id(ADDR_A, 10), id(ADDR_A, 11155420))).toBe(true);
  });
});

describe('classifyWalletIdentityTransition', () => {
  it('classifies steady state and fresh connections', () => {
    expect(classifyWalletIdentityTransition(id(null, null), id(null, null))).toBe('none');
    expect(classifyWalletIdentityTransition(id(null, null), id(ADDR_A, 10))).toBe('connect');
    expect(classifyWalletIdentityTransition(id(ADDR_A, 10), id(null, null))).toBe('disconnect');
  });

  it('classifies account and chain changes', () => {
    expect(classifyWalletIdentityTransition(id(ADDR_A, 10), id(ADDR_B, 10))).toBe('account-change');
    expect(classifyWalletIdentityTransition(id(ADDR_A, 10), id(ADDR_A, 11155420))).toBe('chain-change');
    expect(classifyWalletIdentityTransition(id(ADDR_A, 10), id(ADDR_A, 10))).toBe('none');
  });
});

describe('transition policy', () => {
  it('clears wallet cache on disconnect/account/chain changes only', () => {
    expect(transitionClearsWalletCache('connect')).toBe(false);
    expect(transitionClearsWalletCache('disconnect')).toBe(true);
    expect(transitionClearsWalletCache('account-change')).toBe(true);
    expect(transitionClearsWalletCache('chain-change')).toBe(true);
  });

  it('revalidates auth on every real transition', () => {
    expect(transitionRequiresAuthRevalidation('none')).toBe(false);
    expect(transitionRequiresAuthRevalidation('connect')).toBe(true);
    expect(transitionRequiresAuthRevalidation('disconnect')).toBe(true);
  });

  it('requires explicit recovery only for account/chain changes', () => {
    expect(transitionRequiresRecovery('connect')).toBe(false);
    expect(transitionRequiresRecovery('disconnect')).toBe(false);
    expect(transitionRequiresRecovery('account-change')).toBe(true);
    expect(transitionRequiresRecovery('chain-change')).toBe(true);
  });
});

describe('isWalletScopedQueryKey', () => {
  it('scopes user profiles/reputation/verification and per-user verifications', () => {
    expect(isWalletScopedQueryKey(['user', ADDR_A])).toBe(true);
    expect(isWalletScopedQueryKey(['user', ADDR_A, 'reputation'])).toBe(true);
    expect(isWalletScopedQueryKey(['verifications', 'user', ADDR_A])).toBe(true);
  });

  it('leaves global protocol reads out of scope', () => {
    expect(isWalletScopedQueryKey(['claims'])).toBe(false);
    expect(isWalletScopedQueryKey(['claims', ADDR_A])).toBe(false);
    expect(isWalletScopedQueryKey(['leaderboard'])).toBe(false);
    expect(isWalletScopedQueryKey(['disputes'])).toBe(false);
    expect(isWalletScopedQueryKey(['verifications', 'claim', 'c1'])).toBe(false);
    expect(isWalletScopedQueryKey([])).toBe(false);
  });
});

describe('classifyTransactionIdentityInvalidation', () => {
  const HASH = `0x${'a'.repeat(64)}` as const;

  it('discards unsigned local intents', () => {
    expect(
      classifyTransactionIdentityInvalidation({ status: 'preparing', txHash: null }),
    ).toBe('invalidate-intent');
    expect(
      classifyTransactionIdentityInvalidation({ status: 'signature-requested', txHash: null }),
    ).toBe('invalidate-intent');
  });

  it('preserves submitted/confirming transactions with a real hash', () => {
    expect(
      classifyTransactionIdentityInvalidation({ status: 'submitted', txHash: HASH }),
    ).toBe('preserve-receipt');
    expect(
      classifyTransactionIdentityInvalidation({ status: 'confirming', txHash: HASH }),
    ).toBe('preserve-receipt');
    expect(
      classifyTransactionIdentityInvalidation({ status: 'safe', txHash: HASH }),
    ).toBe('preserve-receipt');
    expect(
      classifyTransactionIdentityInvalidation({ status: 'indexing', txHash: HASH }),
    ).toBe('preserve-receipt');
  });

  it('leaves idle and terminal states untouched', () => {
    expect(
      classifyTransactionIdentityInvalidation({ status: 'idle', txHash: null }),
    ).toBe('none');
    expect(
      classifyTransactionIdentityInvalidation({ status: 'finalized', txHash: HASH }),
    ).toBe('none');
    expect(
      classifyTransactionIdentityInvalidation({ status: 'reverted', txHash: HASH }),
    ).toBe('none');
  });
});
